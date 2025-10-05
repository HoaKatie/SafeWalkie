from flask import Flask, request, jsonify
from flask_cors import CORS
import pika
import json
from datetime import datetime
import uuid
import os, math, requests, threading, time
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# ------------------------------
# RabbitMQ Setup
# ------------------------------
connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
channel.queue_declare(queue="location_updates")
channel.queue_declare(queue="alert_events")

def publish_event(event_type, data):
    """Helper function to publish messages to RabbitMQ"""
    event = {
        "type": event_type,
        "timestamp": datetime.utcnow().isoformat(),
        "data": data
    }
    channel.basic_publish(
        exchange='',
        routing_key='location_updates',
        body=json.dumps(event)
    )
    print(f"[x] Published event: {event}")

#-------------------------------
# Helpers
#-------------------------------

def validate_point(obj, key):
    val = obj.get(key)
    if not (isinstance(val, (list, tuple)) and len(val) == 2):
        return False, f"Invalid '{key}': must be [lon, lat]"
    try:
        lon = float(val[0])
        lat = float(val[1])
    except (TypeError, ValueError):
        return False, f"Invalid '{key}': lon/lat must be numbers"
    if not (math.isfinite(lon) and math.isfinite(lat)):
        return False, f"Invalid '{key}': lon/lat must be finite"
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return False, f"Invalid '{key}': lon in [-180,180], lat in [-90,90]"
    return True, [lon, lat]

# ----- routing (walking) -----
def build_mapbox_walking_route(start, end):
    token = os.environ.get("MAPBOX_TOKEN", "")
    if not token:
        raise RuntimeError("MAPBOX_TOKEN not set")
    s_lon, s_lat = start
    e_lon, e_lat = end
    url = (
        "https://api.mapbox.com/directions/v5/mapbox/walking/"
        f"{s_lon},{s_lat};{e_lon},{e_lat}"
        f"?geometries=geojson&overview=full&access_token={token}"
    )
    r = requests.get(url, timeout=6)
    r.raise_for_status()
    data = r.json()
    routes = data.get("routes") or []
    if not routes:
        raise RuntimeError("No walking route from Mapbox")
    return routes[0]["geometry"]["coordinates"]

def build_straight_route(start, end, steps=30):
    s_lon, s_lat = start
    e_lon, e_lat = end
    return [
        [s_lon + (i/steps)*(e_lon - s_lon), s_lat + (i/steps)*(e_lat - s_lat)]
        for i in range(steps + 1)
    ]

# ------------------------------
# Flask Routes
# ------------------------------

@app.route("/start_walk", methods=["POST"])
def start_walk():
    """
    Body:
    {
      "user_id": 1,
      "start_location": [<lon>, <lat>],
      "end_location": [<lon>, <lat>]
    }
    """
    try:
        data = request.get_json(force=True, silent=False)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    # user_id
    user_id = data.get("user_id")
    if user_id is None:
        return jsonify({"error": "Missing 'user_id'"}), 400

    # start/end validation
    ok, start = validate_point(data, "start_location")
    if not ok:
        return jsonify({"error": start}), 400
    ok, end = validate_point(data, "end_location")
    if not ok:
        return jsonify({"error": end}), 400

    # session id
    walking_session_id = str(uuid.uuid4())

    # server computes the walking route
    try:
        route = build_mapbox_walking_route(start, end)
    except Exception as e:
        print(f"[!] Mapbox routing failed: {e}, using straight line")
        route = build_straight_route(start, end, steps=30)

    # Ensure array-of-arrays in JSON (not tuples)
    route = [[float(p[0]), float(p[1])] for p in route]

    # Convert route from [lon, lat] to {"lat": lat, "lon": lon} format for analytics
    route_for_analytics = [{"lon": p[0], "lat": p[1]} for p in route]

    # Publish event for analytics consumer
    publish_event("walk.started", {
        "walking_session_id": walking_session_id,
        "user_id": str(user_id),
        "start_location": start,
        "destination": end,
        "route": route_for_analytics,
    })

    # Respond to FE
    return jsonify({
        "walking_session_id": walking_session_id,
        "route": route
    }), 200

@app.route("/stop_walk", methods=["POST"])
def stop_walk():
    """
    Body:
    {
        "user_id": 1,
        "walking_session_id": "<uuid>"
    }
    """
    try:
        data = request.get_json(force=True, silent=False)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    user_id = data.get("user_id")
    if user_id is None:
        return jsonify({"error": "Missing 'user_id'"}), 400
    walking_session_id = data.get("walking_session_id")
    if not walking_session_id:
        return jsonify({"error": "Missing 'walking_session_id'"}), 400

    publish_event("walk.stopped", {
        "walking_session_id": walking_session_id,
        "user_id": str(user_id)
    })

    return jsonify({"message": "Walk stopped"}), 200

@app.route('/update_location', methods=['POST'])
def update_location():
    """
    Endpoint for clients to send real-time location updates.
    Example JSON body:
    {
        "user_id": 1,
        "current_location": [lon, lat],
        "walking_session_id": "<uuid>" (optional)
    }
    """
    try:
        data = request.get_json(force=True, silent=False)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400
    
    # Get user_id
    user_id = data.get("user_id")
    if user_id is None:
        return jsonify({"error": "Missing 'user_id'"}), 400
    
    # Get current location
    cur = data.get("current_location")
    if not isinstance(cur, (list, tuple)) or len(cur) != 2:
        return jsonify({"error": "current_location must be an array [lon, lat]"}), 400

    # Parse & validate numbers
    try:
        lon = float(cur[0])
        lat = float(cur[1])
    except (TypeError, ValueError):
        return jsonify({"error": "lon and lat must be numbers"}), 400

    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return jsonify({"error": "current_location out of bounds"}), 400

    # Publish event to RabbitMQ in the format expected by analytics service
    publish_event("location.update", {
        "user_id": str(user_id),
        "lat": lat,
        "lon": lon,
        "walking_session_id": data.get("walking_session_id")
    })

    return jsonify({"status": "queued", "message": "Location update sent to queue"}), 200

latest_risk = {}  # sid -> update dict

@app.post("/risk_update")
def risk_update():
    data = request.get_json(force=True)
    sid = data.get("walking_session_id")
    if sid:
        latest_risk[sid] = data
    return ("", 204)

@app.get("/risk/latest")
def risk_latest():
    # Check both by session_id and user_id
    sid = request.args.get("sid")
    if sid and sid in latest_risk:
        return jsonify(latest_risk[sid]), 200
    
    # Fallback to user_id if session not found
    uid = request.args.get("user_id")
    if uid and uid in latest_risk:
        return jsonify(latest_risk[uid]), 200
    
    return jsonify({}), 200

# ------------------------------
# Consumer for alert_events from analytics service
# ------------------------------
def on_alert_event(ch, method, properties, body):
    try:
        event = json.loads(body)
        data = event.get("data", {})
        event_type = event.get("type")
        user_id = data.get("user_id")
        sid = data.get("walking_session_id")   # <— NEW

        print(f"[🚨] Alert received: {event_type} for user {user_id} sid={sid}")
        print(f"     Message: {data.get('message')}")

        payload = {
            "alert_type": event_type,
            "message": data.get("message"),
            "timestamp": event.get("timestamp"),
            "user_id": user_id,
            "walking_session_id": sid,
        }

        # store by session if available
        if sid:
            latest_risk[sid] = payload

        # also store by user_id as a fallback / debugging view
        if user_id:
            latest_risk[user_id] = payload

    except Exception as e:
        print(f"[!] Error processing alert: {e}")

def alert_consumer_loop():
    """Consume alerts from analytics service"""
    while True:
        try:
            conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
            ch = conn.channel()
            ch.queue_declare(queue="alert_events")
            ch.basic_consume(queue="alert_events", on_message_callback=on_alert_event, auto_ack=True)
            print("[*] Alert consumer: listening to 'alert_events'…")
            ch.start_consuming()
        except Exception as e:
            print(f"[!] Alert consumer error: {e}. Reconnecting in 3s…")
            time.sleep(3)

# Start alert consumer in background
threading.Thread(target=alert_consumer_loop, daemon=True).start()

# ------------------------------
# Run Flask App
# ------------------------------
if __name__ == "__main__":
    app.run(debug=True, port=5001, use_reloader=False)