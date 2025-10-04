# sender.py
import pika
import json
from datetime import datetime

# 1️⃣ Connect to RabbitMQ server
connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

# 2️⃣ Declare a queue (idempotent — safe to call multiple times)
channel.queue_declare(queue='location_updates')

# 3️⃣ Prepare a test message
message = {
    "user_id": "user_001",
    "lat": 45.4215,
    "lon": -75.6993,
    "timestamp": datetime.utcnow().isoformat()
}

# 4️⃣ Publish to the queue
channel.basic_publish(
    exchange='',                  # Default exchange
    routing_key='location_updates', # Queue name
    body=json.dumps(message)       # Message body as JSON
)

print(f"[x] Sent: {message}")

# 5️⃣ Close connection
connection.close()
