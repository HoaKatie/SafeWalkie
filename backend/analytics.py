from flask import Flask, request, jsonify
from datetime import datetime, timedelta
import pika, json, math, threading, time

# =========================
# Flask app
# =========================
app = Flask(__name__)

# -------------------------
# In-memory sessions
# -------------------------
class WalkSession:
    def __init__(self, user_id, route=None, route_id=None):
        self.user_id = user_id
        self.route_id = route_id
        self.route = route or []               # list of {"lat":..,"lon":..}
        self.start_time = datetime.utcnow()
        self.is_active = True
        self.locations = []                    # list of {"lat","lon","timestamp"}
        self.last_update = None
        self.last_alert_time = {}              # alert_type -> timestamp

active_sessions = {}

# =========================
# RabbitMQ (publisher) — own connection (thread-safe via lock)
# =========================
RABBIT_PARAMS = pika.ConnectionParameters("localhost")
LOCATION_QUEUE = "location_updates"
ALERT_QUEUE = "alert_events"

class RabbitPublisher:
    def __init__(self, params):
        self.params = params
        self._lock = threading.Lock()
        self._connect()

    def _connect(self):
        self.conn = pika.BlockingConnection(self.params)
        self.ch = self.conn.channel()
        self.ch.queue_declare(queue=LOCATION_QUEUE)
        self.ch.queue_declare(queue=ALERT_QUEUE)

    def publish(self, queue, event_type, data):
        event = {
            "type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "data": data
        }
        body = json.dumps(event)
        with self._lock:
            try:
                self.ch.basic_publish(exchange="", routing_key=queue, body=body)
            except Exception:
                # reconnect once and retry
                try:
                    self._connect()
                    self.ch.basic_publish(exchange="", routing_key=queue, body=body)
                except Exception as e:
                    print(f"[!] Publish failed: {e}")
                    return
        print(f"[x] Published {event_type} → {queue}: {event}")

publisher = RabbitPublisher(RABBIT_PARAMS)

def publish_event(queue, event_type, data):
    publisher.publish(queue, event_type, data)

# =========================
# Utilities
# =========================
def haversine(lat1, lon1, lat2, lon2):
    """Distance between two lat/lon points in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

def rate_limited(session: WalkSession, alert_type: str, min_interval_sec: int) -> bool:
    """Return True if we should SKIP sending (too soon)."""
    last = session.last_alert_time.get(alert_type)
    if last and (datetime.utcnow() - last).total_seconds() < min_interval_sec:
        return True
    session.last_alert_time[alert_type] = datetime.utcnow()
    return False

# =========================
# Real-time analytics (per-message)
# =========================
def perform_safety_analysis(user_id: str, session: WalkSession):
    if len(session.locations) < 2:
        return

    now = datetime.utcnow()
    last = session.locations[-1]
    prev = session.locations[-2]

    lat1, lon1 = prev["lat"], prev["lon"]
    lat2, lon2 = last["lat"], last["lon"]
    dist = haversine(lat1, lon1, lat2, lon2)

    t1 = datetime.fromisoformat(prev["timestamp"])
    t2 = datetime.fromisoformat(last["timestamp"])
    dt = max(1e-6, (t2 - t1).total_seconds())
    speed_mps = dist / dt

    # Condition A: suspicious jump (GPS glitch / teleport)
    if dist > 1000 and not rate_limited(session, "suspicious_jump", 120):
        publish_event(ALERT_QUEUE, "suspicious_jump", {
            "user_id": user_id,
            "message": f"Unusual jump of {int(dist)} m detected."
        })

    # Condition B: late-night walk
    if (now.hour >= 23 or now.hour <= 5) and not rate_limited(session, "night_time", 600):
        publish_event(ALERT_QUEUE, "night_time", {
            "user_id": user_id,
            "message": "Walking late at night — stay safe."
        })

    # Condition C: off-route (simple: >500m from route start if route exists)
    if session.route:
        start = session.route[0]
        off_dist = haversine(lat2, lon2, start["lat"], start["lon"])
        if off_dist > 500 and not rate_limited(session, "off_route", 180):
            publish_event(ALERT_QUEUE, "off_route", {
                "user_id": user_id,
                "message": f"Deviated ~{int(off_dist)} m from route start."
            })

# =========================
# Background watchdog: inactivity detection (even if no new messages)
# =========================
# --- Inactivity config (env overrideable) ---
INACTIVITY_THRESHOLD_SEC = 15   # alert after 15s idle
WATCHDOG_INTERVAL_SEC   = 5 # check every 5s
NO_MOVE_ALERT_COOLDOWN  = 30 # avoid spam

def watchdog_inactivity_check():
    """Every WATCHDOG_INTERVAL_SEC: if a user hasn't updated for > INACTIVITY_THRESHOLD_SEC, alert."""
    while True:
        now = datetime.utcnow()
        for user_id, session in list(active_sessions.items()):
            if not session.is_active or not session.last_update:
                continue

            idle = (now - session.last_update).total_seconds()
            if idle > INACTIVITY_THRESHOLD_SEC and not rate_limited(session, "no_movement", NO_MOVE_ALERT_COOLDOWN):
                publish_event(ALERT_QUEUE, "no_movement", {
                    "user_id": user_id,
                    "message": f"No movement detected for {INACTIVITY_THRESHOLD_SEC}+ seconds."
                })
        time.sleep(WATCHDOG_INTERVAL_SEC)

# =========================
# RabbitMQ consumer (separate thread & connection)
# =========================
def on_location_update(ch, method, properties, body):
    """Process each event from RabbitMQ in real time."""
    try:
        event = json.loads(body)
        data = event.get("data", {})
        user_id = str(data["user_id"])
        lat, lon = float(data["lat"]), float(data["lon"])
    except Exception as e:
        print(f"[!] Bad message, skipping: {e} | body={body!r}")
        return

    # Ensure session exists
    session = active_sessions.get(user_id)
    if not session:
        session = WalkSession(user_id)
        active_sessions[user_id] = session

    # Update session state
    loc = {"lat": lat, "lon": lon, "timestamp": datetime.utcnow().isoformat()}
    session.locations.append(loc)
    session.last_update = datetime.utcnow()

    print(f"[📍] {user_id} → ({lat:.6f}, {lon:.6f})")
    perform_safety_analysis(user_id, session)

def consumer_loop():
    """Keeps the consumer alive; reconnects on failure."""
    while True:
        try:
            conn = pika.BlockingConnection(RABBIT_PARAMS)
            ch = conn.channel()
            ch.queue_declare(queue=LOCATION_QUEUE)
            ch.queue_declare(queue=ALERT_QUEUE)
            ch.basic_consume(queue=LOCATION_QUEUE, on_message_callback=on_location_update, auto_ack=True)
            print("[*] Consumer: listening to 'location_updates'…")
            ch.start_consuming()
        except Exception as e:
            print(f"[!] Consumer error: {e}. Reconnecting in 3s…")
            time.sleep(3)

# Start background threads
threading.Thread(target=consumer_loop, daemon=True).start()
threading.Thread(target=watchdog_inactivity_check, daemon=True).start()

# =========================
# REST endpoints
# =========================
@app.route("/")
def home():
    return jsonify({
        "status": "Real-time Analytics API running",
        "sessions": list(active_sessions.keys())
    })

@app.route("/start_walk", methods=["POST"])
def start_walk():
    data = request.get_json(force=True)
    user_id = data["user_id"]
    route = data.get("route", [])
    route_id = data.get("route_id")
    active_sessions[user_id] = WalkSession(user_id, route, route_id)
    print(f"[+] Started walk for {user_id}")
    return jsonify({"message": "Walk started", "user_id": user_id})

@app.route("/update_location", methods=["POST"])
def update_location_endpoint():
    """
    Accepts client updates and publishes them to RabbitMQ.
    The consumer thread will receive and analyze them in real time.
    """
    data = request.get_json(force=True)
    if not all(k in data for k in ("user_id", "lat", "lon")):
        return jsonify({"error": "Missing required fields"}), 400

    publish_event(LOCATION_QUEUE, "location_update", {
        "user_id": data["user_id"],
        "lat": float(data["lat"]),
        "lon": float(data["lon"]),
    })
    return jsonify({"status": "queued"})

@app.route("/stop_walk", methods=["POST"])
def stop_walk():
    data = request.get_json(force=True)
    user_id = data["user_id"]
    session = active_sessions.get(user_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    session.is_active = False
    end_time = datetime.utcnow()
    duration = str(end_time - session.start_time)
    print(f"[-] Walk stopped for {user_id}, duration: {duration}")
    return jsonify({"message": "Walk stopped", "duration": duration})

# =========================
# Run
# =========================
if __name__ == "__main__":
    # Run the unified API + consumer app on 5001 (match your simulator if needed)
    app.run(debug=True, port=5002)
