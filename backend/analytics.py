# from flask import Flask, request, jsonify
# from datetime import datetime, timedelta
# import pika, json, math, threading, time

# # =========================
# # Flask app
# # =========================
# app = Flask(__name__)

# # -------------------------
# # In-memory sessions
# # -------------------------
# class WalkSession:
#     def __init__(self, user_id, route=None, route_id=None):
#         self.user_id = user_id
#         self.route_id = route_id
#         self.route = route or []               # list of {"lat":..,"lon":..}
#         self.start_time = datetime.utcnow()
#         self.is_active = True
#         self.locations = []                    # list of {"lat","lon","timestamp"}
#         self.last_update = None
#         self.last_alert_time = {}              # alert_type -> timestamp

# active_sessions = {}

# # =========================
# # RabbitMQ (publisher) — own connection (thread-safe via lock)
# # =========================
# RABBIT_PARAMS = pika.ConnectionParameters("localhost")
# LOCATION_QUEUE = "location_updates"
# ALERT_QUEUE = "alert_events"

# # --- heuristics (only off-route) ---
# OFF_ROUTE_THRESHOLD_M = 35.0     # distance from polyline to count as off-route
# OFF_ROUTE_SUSTAIN_S   = 20.0     # must stay off-route for this long
# TICK_SEC              = 10       # recompute about every 10s

# class RabbitPublisher:
#     def __init__(self, params):
#         self.params = params
#         self._lock = threading.Lock()
#         self._connect()

#     def _connect(self):
#         self.conn = pika.BlockingConnection(self.params)
#         self.ch = self.conn.channel()
#         self.ch.queue_declare(queue=LOCATION_QUEUE)
#         self.ch.queue_declare(queue=ALERT_QUEUE)

#     def publish(self, queue, event_type, data):
#         event = {
#             "type": event_type,
#             "timestamp": datetime.utcnow().isoformat(),
#             "data": data
#         }
#         body = json.dumps(event)
#         with self._lock:
#             try:
#                 self.ch.basic_publish(exchange="", routing_key=queue, body=body)
#             except Exception:
#                 # reconnect once and retry
#                 try:
#                     self._connect()
#                     self.ch.basic_publish(exchange="", routing_key=queue, body=body)
#                 except Exception as e:
#                     print(f"[!] Publish failed: {e}")
#                     return
#         print(f"[x] Published {event_type} → {queue}: {event}")

# publisher = RabbitPublisher(RABBIT_PARAMS)

# def publish_event(queue, event_type, data):
#     publisher.publish(queue, event_type, data)

# # =========================
# # Utilities
# # =========================
# def haversine(lat1, lon1, lat2, lon2):
#     """Distance between two lat/lon points in meters."""
#     R = 6371000
#     phi1, phi2 = math.radians(lat1), math.radians(lat2)
#     dphi = math.radians(lat2 - lat1)
#     dlambda = math.radians(lon2 - lon1)
#     a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
#     return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

# def rate_limited(session: WalkSession, alert_type: str, min_interval_sec: int) -> bool:
#     """Return True if we should SKIP sending (too soon)."""
#     last = session.last_alert_time.get(alert_type)
#     if last and (datetime.utcnow() - last).total_seconds() < min_interval_sec:
#         return True
#     session.last_alert_time[alert_type] = datetime.utcnow()
#     return False

# # =========================
# # Real-time analytics (per-message)
# # =========================
# def perform_safety_analysis(user_id: str, session: WalkSession):
#     if len(session.locations) < 2:
#         return

#     now = datetime.utcnow()
#     last = session.locations[-1]
#     prev = session.locations[-2]

#     lat1, lon1 = prev["lat"], prev["lon"]
#     lat2, lon2 = last["lat"], last["lon"]
#     dist = haversine(lat1, lon1, lat2, lon2)

#     t1 = datetime.fromisoformat(prev["timestamp"])
#     t2 = datetime.fromisoformat(last["timestamp"])
#     dt = max(1e-6, (t2 - t1).total_seconds())
#     speed_mps = dist / dt

#     # Condition A: suspicious jump (GPS glitch / teleport)
#     if dist > 1000 and not rate_limited(session, "suspicious_jump", 120):
#         publish_event(ALERT_QUEUE, "suspicious_jump", {
#             "user_id": user_id,
#             "message": f"Unusual jump of {int(dist)} m detected."
#         })

#     # Condition B: late-night walk
#     if (now.hour >= 23 or now.hour <= 5) and not rate_limited(session, "night_time", 600):
#         publish_event(ALERT_QUEUE, "night_time", {
#             "user_id": user_id,
#             "message": "Walking late at night — stay safe."
#         })

#     # Condition C: off-route (simple: >500m from route start if route exists)
#     if session.route:
#         start = session.route[0]
#         off_dist = haversine(lat2, lon2, start["lat"], start["lon"])
#         if off_dist > 500 and not rate_limited(session, "off_route", 180):
#             publish_event(ALERT_QUEUE, "off_route", {
#                 "user_id": user_id,
#                 "message": f"Deviated ~{int(off_dist)} m from route start."
#             })

# # =========================
# # Background watchdog: inactivity detection (even if no new messages)
# # =========================
# # --- Inactivity config (env overrideable) ---
# INACTIVITY_THRESHOLD_SEC = 15   # alert after 15s idle
# WATCHDOG_INTERVAL_SEC   = 5 # check every 5s
# NO_MOVE_ALERT_COOLDOWN  = 30 # avoid spam

# def watchdog_inactivity_check():
#     """Every WATCHDOG_INTERVAL_SEC: if a user hasn't updated for > INACTIVITY_THRESHOLD_SEC, alert."""
#     while True:
#         now = datetime.utcnow()
#         for user_id, session in list(active_sessions.items()):
#             if not session.is_active or not session.last_update:
#                 continue

#             idle = (now - session.last_update).total_seconds()
#             if idle > INACTIVITY_THRESHOLD_SEC and not rate_limited(session, "no_movement", NO_MOVE_ALERT_COOLDOWN):
#                 publish_event(ALERT_QUEUE, "no_movement", {
#                     "user_id": user_id,
#                     "message": f"No movement detected for {INACTIVITY_THRESHOLD_SEC}+ seconds."
#                 })
#         time.sleep(WATCHDOG_INTERVAL_SEC)

# # =========================
# # RabbitMQ consumer (separate thread & connection)
# # =========================
# def on_location_update(ch, method, properties, body):
#     """Process each event from RabbitMQ in real time."""
#     try:
#         event = json.loads(body)
#         data = event.get("data", {})
#         user_id = str(data["user_id"])
#         lat, lon = float(data["lat"]), float(data["lon"])
#     except Exception as e:
#         print(f"[!] Bad message, skipping: {e} | body={body!r}")
#         return

#     # Ensure session exists
#     session = active_sessions.get(user_id)
#     if not session:
#         session = WalkSession(user_id)
#         active_sessions[user_id] = session

#     # Update session state
#     loc = {"lat": lat, "lon": lon, "timestamp": datetime.utcnow().isoformat()}
#     session.locations.append(loc)
#     session.last_update = datetime.utcnow()

#     print(f"[📍] {user_id} → ({lat:.6f}, {lon:.6f})")
#     perform_safety_analysis(user_id, session)

# def consumer_loop():
#     """Keeps the consumer alive; reconnects on failure."""
#     while True:
#         try:
#             conn = pika.BlockingConnection(RABBIT_PARAMS)
#             ch = conn.channel()
#             ch.queue_declare(queue=LOCATION_QUEUE)
#             ch.queue_declare(queue=ALERT_QUEUE)
#             ch.basic_consume(queue=LOCATION_QUEUE, on_message_callback=on_location_update, auto_ack=True)
#             print("[*] Consumer: listening to 'location_updates'…")
#             ch.start_consuming()
#         except Exception as e:
#             print(f"[!] Consumer error: {e}. Reconnecting in 3s…")
#             time.sleep(3)

# # Start background threads
# threading.Thread(target=consumer_loop, daemon=True).start()
# threading.Thread(target=watchdog_inactivity_check, daemon=True).start()

# # =========================
# # Run
# # =========================
# if __name__ == "__main__":
#     # Run the unified API + consumer app on 5001 (match your simulator if needed)
#     app.run(debug=True, port=5002)

# analytics.py — consumer with console logging + FE push (via backend)
import json, math, time, threading, os
from datetime import datetime
import pika
import requests  # pip install requests

# ---------- broker config ----------
RABBIT = pika.ConnectionParameters("localhost")
IN_Q   = "location_updates_v2"    # producer writes here
OUT_Q  = "analytics_updates_v2"   # we write risk.updated here

# ---------- knobs ----------
OFF_ROUTE_THRESHOLD_M = 35.0
OFF_ROUTE_SUSTAIN_S   = 20.0
TICK_SEC              = 10
EARTH_R               = 6371000.0

# Optional: where to POST risk updates so the backend can forward to FE
BACKEND_PUSH_URL = os.getenv("BACKEND_PUSH_URL")  # e.g., http://localhost:5001/risk_update
PUSH_TIMEOUT_S   = 2.0

# ---------- geo helpers ----------
def haversine_m(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    x = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*EARTH_R*math.asin(math.sqrt(x))

def _dist_point_to_segment_m(a, b, p):
    lat0 = (a[1] + b[1]) * 0.5
    def xy(lon, lat):
        return (math.radians(lon)*EARTH_R*math.cos(math.radians(lat0)),
                math.radians(lat)*EARTH_R)
    ax, ay = xy(*a); bx, by = xy(*b); px, py = xy(*p)
    abx, aby = bx-ax, by-ay
    ab2 = abx*abx + aby*aby
    if ab2 == 0: return math.hypot(px-ax, py-ay)
    t = max(0.0, min(1.0, ((px-ax)*abx + (py-ay)*aby)/ab2))
    qx, qy = ax + t*abx, ay + t*aby
    return math.hypot(px-qx, py-qy)

def dist_to_polyline_m(route, p):
    if not route: return float("inf")
    if len(route) == 1: return haversine_m(route[0], p)
    best = float("inf")
    for i in range(len(route)-1):
        best = min(best, _dist_point_to_segment_m(route[i], route[i+1], p))
    return best

# ---------- state ----------
sessions = {}     # sid -> {...}
user_to_sid = {}  # user_id -> sid

def level_from(score: int) -> str:
    return "green" if score <= 24 else ("amber" if score <= 59 else "red")

# ---------- broker helpers ----------
def mk_conn_ch():
    conn = pika.BlockingConnection(RABBIT)
    ch = conn.channel()
    ch.queue_declare(queue=IN_Q, durable=True)
    ch.queue_declare(queue=OUT_Q, durable=True)
    ch.basic_qos(prefetch_count=32)
    return conn, ch

def publish(ch, typ, data):
    body = json.dumps({"type": typ, "ts": datetime.utcnow().isoformat(), "data": data})
    ch.basic_publish(
        exchange="",
        routing_key=OUT_Q,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2),
    )

def push_to_backend(update: dict):
    """Optional: POST risk update to backend so it can notify FE (SSE/WebSocket/poll)."""
    if not BACKEND_PUSH_URL:
        return
    try:
        requests.post(BACKEND_PUSH_URL, json=update, timeout=PUSH_TIMEOUT_S)
    except Exception as e:
        print(f"[analytics] FE push failed: {e}")

# ---------- handlers ----------
def on_walk_started(data):
    sid = data["walking_session_id"]
    uid = str(data.get("user_id", ""))
    sessions[sid] = {
        "user_id": uid,
        "route": data.get("route", []),
        "last": None,
        "off_since": None,
        "score": 0,
        "level": "green",
    }
    user_to_sid[uid] = sid
    print(f"[analytics] walk.started sid={sid} user={uid} route_pts={len(sessions[sid]['route'])}")

def on_location_updated(data):
    uid = str(data.get("user_id", ""))
    lon, lat = float(data["lon"]), float(data["lat"])
    sid = user_to_sid.get(uid)
    if sid and sid in sessions:
        sessions[sid]["last"] = [lon, lat]

# ---------- scoring tick ----------
def collect_updates(now):
    updates = []
    for sid, s in sessions.items():
        score = 0
        if s["last"] and s["route"]:
            d = dist_to_polyline_m(s["route"], s["last"])
            if d > OFF_ROUTE_THRESHOLD_M:
                s["off_since"] = s["off_since"] or now
                if now - s["off_since"] >= OFF_ROUTE_SUSTAIN_S:
                    score += 35
            else:
                s["off_since"] = None

        score = max(0, min(100, score))
        prev = s.get("score", 0)
        if score != prev:
            s["score"] = score
            updates.append({
                "walking_session_id": sid,
                "user_id": s["user_id"],   # optional, handy for logs
                "riskScore": score         # FE contract
            })
    return updates

# ---------- main ----------
def main():
    # consumer connection/channel (this thread)
    conn, ch = mk_conn_ch()
    # publisher connection/channel (ticker thread)
    pub_conn, pub_ch = mk_conn_ch()

    def on_msg(ch_, method, props, body):
        try:
            evt = json.loads(body)
            typ = evt.get("type"); data = evt.get("data", {})
            if typ == "walk.started":
                on_walk_started(data)
            elif typ in ("location.updated", "loc.updated"):
                on_location_updated(data)
            ch_.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            print("[analytics] bad msg:", e)
            ch_.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    ch.basic_consume(queue=IN_Q, on_message_callback=on_msg, auto_ack=False)

    def ticker():
        while True:
            try:
                now = time.time()
                for upd in collect_updates(now):
                    # 1) print to console
                    print(f"[risk.updated] sid={upd['walking_session_id']} user={upd['user_id']} "
                          f"score={upd['score']}")
                    # 2) publish to analytics queue (other consumers)
                    publish(pub_ch, "risk.updated", upd)
                    # 3) push to backend so FE can see it live (optional)
                    push_to_backend(upd)
            except Exception as e:
                print("[analytics] tick error:", e)
            time.sleep(TICK_SEC)

    threading.Thread(target=ticker, daemon=True).start()
    print("[analytics] consuming…")
    try:
        ch.start_consuming()
    finally:
        try: pub_conn.close()
        except: pass
        try: conn.close()
        except: pass

if __name__ == "__main__":
    main()
