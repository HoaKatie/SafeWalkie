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
        self.walking_session_id = None          # <— NEW
        self.route = route or []
        self.start_time = datetime.utcnow()
        self.is_active = True
        self.locations = []
        self.last_update = None
        self.last_alert_time = {}


active_sessions = {}

# =========================
# RabbitMQ (publisher) — own connection (thread-safe via lock)
# =========================
RABBIT_PARAMS = pika.ConnectionParameters("localhost")
LOCATION_QUEUE = "location_updates"
ALERT_QUEUE = "alert_events"

# --- heuristics (only off-route) ---
OFF_ROUTE_THRESHOLD_M = 35.0     # distance from polyline to count as off-route
OFF_ROUTE_SUSTAIN_S   = 20.0     # must stay off-route for this long
TICK_SEC              = 10       # recompute about every 10s

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
# ========= safety analysis =========
# =========================
# Simplified Off-Route Analysis
# =========================
def nearest_point_distance(lat, lon, route):
    """Return min distance (m) from (lat, lon) to route polyline."""
    if not route or len(route) < 2:
        return None

    def haversine_m(p1, p2):
        R = 6371000
        phi1, phi2 = math.radians(p1[0]), math.radians(p2[0])
        dphi = math.radians(p2[0] - p1[0])
        dlambda = math.radians(p2[1] - p1[1])
        a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    min_dist = float("inf")
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        # convert to meters using simple projection near first point
        x1, y1 = _to_local_xy(a["lat"], a["lon"], lat, lon)
        x2, y2 = _to_local_xy(b["lat"], b["lon"], lat, lon)
        px, py = 0, 0  # current point
        dist, *_ = _point_segment_distance_xy(px, py, x1, y1, x2, y2)
        if dist < min_dist:
            min_dist = dist
    return min_dist


def _to_local_xy(lat, lon, lat0, lon0):
    """Approximate conversion to local XY coordinates in meters."""
    R = 6371000
    dlon = math.radians(lon - lon0)
    dlat = math.radians(lat - lat0)
    x = dlon * R * math.cos(math.radians(lat0))
    y = dlat * R
    return x, y


def _point_segment_distance_xy(px, py, ax, ay, bx, by):
    """Distance from point P to segment AB (in meters)."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    c1 = wx * vx + wy * vy
    c2 = vx * vx + vy * vy
    t = max(0, min(1, c1 / c2)) if c2 > 0 else 0
    projx, projy = ax + t * vx, ay + t * vy
    dx, dy = px - projx, py - projy
    return math.hypot(dx, dy), t, projx, projy


def perform_safety_analysis(user_id: str, session: WalkSession):
    """Simplified safety + off-route checks."""
    if len(session.locations) < 2:
        return

    last = session.locations[-1]
    prev = session.locations[-2]

    # Compute basic speed
    dist = haversine(prev["lat"], prev["lon"], last["lat"], last["lon"])
    dt = max(1e-6, (datetime.fromisoformat(last["timestamp"]) - datetime.fromisoformat(prev["timestamp"])).total_seconds())

    # Simple off-route alert
    if session.route:
        dist_from_route = nearest_point_distance(last["lat"], last["lon"], session.route)
        if dist_from_route and dist_from_route > OFF_ROUTE_THRESHOLD_M and not rate_limited(session, "off_route", 5):
            publish_event(ALERT_QUEUE, "off_route", {
                "user_id": user_id,
                "walking_session_id": session.walking_session_id,
                "message": f"Off-route by ~{int(dist_from_route)} m (>{OFF_ROUTE_THRESHOLD_M} m threshold)"
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

def _handle_walk_started(data):
    user_id = str(data["user_id"])
    sid = data.get("walking_session_id")
    route = data.get("route") or []  # [{lat, lon}, ...]

    session = active_sessions.get(user_id)
    if not session:
        session = WalkSession(user_id)
        active_sessions[user_id] = session

    session.walking_session_id = sid
    session.route = route
    session.is_active = True
    session._route_cache = None       # force rebuild
    session._last_seg_idx = None
    print(f"[🏁] walk.started user={user_id} sid={sid} route_pts={len(route)}")

def _handle_walk_stopped(data):
    user_id = str(data["user_id"])
    session = active_sessions.get(user_id)
    if session:
        session.is_active = False
        print(f"[🛑] walk.stopped user={user_id} sid={getattr(session,'walking_session_id',None)}")

def _handle_location_update(data):
    user_id = str(data["user_id"])
    lat, lon = float(data["lat"]), float(data["lon"])

    session = active_sessions.get(user_id)
    if not session:
        # create a shell session; route may arrive later
        session = WalkSession(user_id)
        active_sessions[user_id] = session

    # remember sid if client sends it here first
    sid = data.get("walking_session_id")
    if sid and not getattr(session, "walking_session_id", None):
        session.walking_session_id = sid

    loc = {"lat": lat, "lon": lon, "timestamp": datetime.utcnow().isoformat()}
    session.locations.append(loc)
    session.last_update = datetime.utcnow()

    print(f"[📍] {user_id} → ({lat:.6f}, {lon:.6f}) sid={session.walking_session_id}")
    perform_safety_analysis(user_id, session)

def on_queue_message(ch, method, properties, body):
    """Dispatch based on event['type']."""
    try:
        event = json.loads(body)
        etype = event.get("type")
        data = event.get("data", {}) or {}
    except Exception as e:
        print(f"[!] Bad JSON: {e} | body={body!r}")
        return

    try:
        if etype == "walk.started":
            _handle_walk_started(data)
        elif etype == "walk.stopped":
            _handle_walk_stopped(data)
        elif etype == "location.update":
            _handle_location_update(data)
        else:
            print(f"[~] Ignoring unknown event type: {etype}")
    except Exception as e:
        print(f"[!] Handler error for {etype}: {e}")

def consumer_loop():
    while True:
        try:
            conn = pika.BlockingConnection(RABBIT_PARAMS)
            ch = conn.channel()
            ch.queue_declare(queue=LOCATION_QUEUE)
            ch.queue_declare(queue=ALERT_QUEUE)
            ch.basic_consume(queue=LOCATION_QUEUE, on_message_callback=on_queue_message, auto_ack=True)
            print("[*] Consumer: listening to 'location_updates'…")
            ch.start_consuming()
        except Exception as e:
            print(f"[!] Consumer error: {e}. Reconnecting in 3s…")
            time.sleep(3)


# Start background threads
threading.Thread(target=consumer_loop, daemon=True).start()
threading.Thread(target=watchdog_inactivity_check, daemon=True).start()

# =========================
# Run
# =========================
if __name__ == "__main__":
    app.run(debug=True, port=5002, use_reloader=False)  # <— add use_reloader=False
