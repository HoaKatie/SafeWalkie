from flask import Flask, request, jsonify
from datetime import datetime

app = Flask(__name__)

# ------------------------------
# Class for user walk sessions
# ------------------------------
class WalkSession:
    def __init__(self, user_id, route):
        self.user_id = user_id
        self.route = route
        self.start_time = datetime.utcnow()
        self.locations = []  # [(lat, lon, timestamp)]
        self.is_active = True
        self.alert_triggered = False
    
    def update_location(self, lat, lon):
        self.locations.append({
            "lat": lat,
            "lon": lon,
            "timestamp": datetime.utcnow().isoformat()
        })
    
    def trigger_alert(self, message):
        self.alert_triggered = True
        self.alert_message = message
        return {"status": "alert_sent", "user_id": self.user_id, "message": message}
    
    def stop(self):
        self.is_active = False
        self.end_time = datetime.utcnow()


# Global storage (could be replaced by Redis or database later)
active_sessions = {}

# ------------------------------
# Flask routes using OOP model
# ------------------------------

@app.route('/')
def home():
    return "Safety Companion API active."

@app.route('/start_walk', methods=['POST'])
def start_walk():
    data = request.get_json()
    user_id = data['user_id']
    route = data['route']

    session = WalkSession(user_id, route)
    active_sessions[user_id] = session
    return jsonify({"message": "Walk started", "user_id": user_id})

@app.route('/update_location', methods=['POST'])
def update_location():
    data = request.get_json()
    user_id = data['user_id']
    lat, lon = data['lat'], data['lon']

    session = active_sessions.get(user_id)
    if not session or not session.is_active:
        return jsonify({"error": "No active session"}), 404
    
    session.update_location(lat, lon)
    return jsonify({"message": "Location updated", "latest": session.locations[-1]})

@app.route('/send_alert', methods=['POST'])
def send_alert():
    data = request.get_json()
    user_id = data['user_id']
    message = data.get('message', 'Emergency!')

    session = active_sessions.get(user_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    
    result = session.trigger_alert(message)
    return jsonify(result)

@app.route('/stop_walk', methods=['POST'])
def stop_walk():
    data = request.get_json()
    user_id = data['user_id']

    session = active_sessions.get(user_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    session.stop()
    return jsonify({"message": "Walk stopped", "duration": str(session.end_time - session.start_time)})


if __name__ == '__main__':
    app.run(debug=True)
