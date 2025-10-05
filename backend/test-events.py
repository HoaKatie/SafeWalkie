# import requests
# import time
# import random
# from datetime import datetime

# API_BASE = "http://127.0.0.1"  # Flask publisher service port

# USER_ID = "user_001"
# START_LAT, START_LON = 45.4215, -75.6993  # Ottawa downtown coordinates
# STEPS = 50  # number of updates to send
# INTERVAL = 1  # seconds between updates


# def start_walk():
#     """Start a walking session"""
#     payload = {
#         "user_id": USER_ID,
#         "route": [{"lat": START_LAT, "lon": START_LON}]
#     }
#     r = requests.post(f"{API_BASE}:5002/start_walk", json=payload)
#     print(f"[+] Walk started: {r.json()}")

# def send_location(lat, lon):
#     """Send location update"""
#     payload = {"user_id": USER_ID, "lat": lat, "lon": lon}
#     r = requests.post(f"{API_BASE}:5001/update_location", json=payload)
#     if r.status_code == 200:
#         print(f"[📍] Sent location ({lat:.6f}, {lon:.6f}) @ {datetime.now().strftime('%H:%M:%S')}")
#     else:
#         print(f"[❌] Error: {r.text}")


# def stop_walk():
#     """Stop the walking session"""
#     payload = {"user_id": USER_ID}
#     r = requests.post(f"{API_BASE}/stop_walk", json=payload)
#     print(f"[-] Walk stopped: {r.json()}")


# def simulate_walk():
#     """Simulate movement by sending incremental GPS updates"""
#     start_walk()

#     lat, lon = START_LAT, START_LON

#     for step in range(STEPS):
#         # Random small movement (simulate walking 5–10 meters per step)
#         lat += random.uniform(-0.00005, 0.00005)
#         lon += random.uniform(-0.00005, 0.00005)

#         send_location(lat, lon)
#         time.sleep(INTERVAL)

#     stop_walk()


# if __name__ == "__main__":
#     simulate_walk()


# send_event.py
import json, pika
conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()
ch.queue_declare(queue="location_updates", durable=True)

def send(typ, data):
    ch.basic_publish(
        exchange="",
        routing_key="location_updates",
        body=json.dumps({"type": typ, "data": data}),
        properties=pika.BasicProperties(delivery_mode=2),
    )

# 1) Send walk.started
sid = "test-session-1"
route = [[-75.6993,45.4215], [-75.6960,45.4240], [-75.6900,45.4300]]
send("walk.started", {"walking_session_id": sid, "user_id":"tester-123", "route": route})

# 2) On-route location
send("location.updated", {"user_id":"tester-123","lon":-75.6992,"lat":45.4216,"timestamp":"2025-10-05T07:40:00Z"})

# 3) Off-route location (≈60–100 m away)
send("location.updated", {"user_id":"tester-123","lon":-75.7050,"lat":45.4200,"timestamp":"2025-10-05T07:40:20Z"})
conn.close()
print("sent test events")
