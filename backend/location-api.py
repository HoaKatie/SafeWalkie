from flask import Flask, request, jsonify
import pika
import json
from datetime import datetime

app = Flask(__name__)

# ------------------------------
# RabbitMQ Setup
# ------------------------------
connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
channel.queue_declare(queue="location_updates")

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

# ------------------------------
# Flask Routes
# ------------------------------
@app.route('/update_location', methods=['POST'])
def update_location():
    """
    Endpoint for clients to send real-time location updates.
    Example JSON body:
    {
        "user_id": "user_001",
        "lat": 45.4215,
        "lon": -75.6993
    }
    """
    data = request.get_json()

    # Basic validation
    if not data or not all(k in data for k in ("user_id", "lat", "lon")):
        return jsonify({"error": "Missing required fields"}), 400

    # Publish event to RabbitMQ
    publish_event("location_update", data)

    return jsonify({"status": "queued", "message": "Location update sent to queue"}), 200

# ------------------------------
# Run Flask App
# ------------------------------
if __name__ == "__main__":
    app.run(debug=True, port=5001)