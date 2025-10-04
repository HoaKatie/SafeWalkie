# receiver.py
import pika
import json

# 1️⃣ Connect to RabbitMQ server
connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

# 2️⃣ Declare the same queue (must match)
channel.queue_declare(queue='location_updates')

# 3️⃣ Define the callback function for new messages
def callback(ch, method, properties, body):
    data = json.loads(body)
    print(f"[x] Received message: {data}")

# 4️⃣ Subscribe to the queue
channel.basic_consume(
    queue='location_updates',
    on_message_callback=callback,
    auto_ack=True  # Automatically acknowledge messages
)

print("[*] Waiting for messages. To exit, press CTRL+C")
channel.start_consuming()
