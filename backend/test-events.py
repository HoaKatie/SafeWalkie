# save as run_tests.py
import json, time
import requests
from datetime import datetime

TEST_CASES = [
    {
        "name": "TC-1 on-route with small detour",
        "user_id": "u1",
        "route": [
            [-79.344895, 43.763708],
            [-79.344569, 43.764680],
            [-79.343792, 43.764869],
            [-79.343197, 43.764941],
            [-79.342899, 43.764897],
            [-79.342413, 43.764652],
            [-79.342163, 43.764852],
            [-79.342413, 43.764652],
            [-79.342054, 43.764055],
            [-79.341792, 43.763471],
            [-79.341039, 43.763304],
            [-79.340504, 43.763408],
            [-79.340166, 43.763481],
            [-79.339563, 43.763608],
            [-79.339307, 43.763665],
            [-79.339089, 43.763611],
            [-79.338807, 43.763011],
            [-79.338665, 43.762721],
            [-79.338534, 43.762584],
            [-79.338404, 43.762259],
        ],
        "delay_between_points_sec": 1.0
    },
    {
        "name": "TC-2 big jump glitch",
        "user_id": "u2",
        "route": [
            [-79.344895, 43.763708],
            [-79.344569, 43.764680],
            [-79.343792, 43.764869],
            [-79.324895, 43.763708],  # ~1.6 km jump
            [-79.343197, 43.764941],  # jump back (may be rate-limited)
            [-79.342899, 43.764897],
            [-79.342413, 43.764652],
        ],
        "delay_between_points_sec": 0.8
    },
    {
        "name": "TC-3 inactivity then resume",
        "user_id": "u3",
        "route": [
            [-79.344895, 43.763708],
            [-79.344569, 43.764680],
            [-79.343792, 43.764869],
            [-79.343197, 43.764941],
            [-79.342899, 43.764897],
            # pause here
            [-79.342413, 43.764652],
            [-79.342054, 43.764055],
            [-79.341792, 43.763471],
            [-79.341039, 43.763304],
        ],
        "delay_between_points_sec": 1.0,
        "pause_after_index": 4,
        "pause_seconds": 20
    }
]

API_BASE_URL = "http://localhost:5001"

def send_location_update(user_id, lon, lat):
    """Send location update via HTTP to port 5001"""
    payload = {
        "user_id": user_id,
        "current_location": [lon, lat]
    }
    try:
        response = requests.post(
            f"{API_BASE_URL}/update_location",
            json=payload,
            timeout=5
        )
        if response.status_code == 200:
            print(f"[→] {user_id} ({lat:.6f},{lon:.6f}) sent → {response.json()['status']}")
        else:
            print(f"[!] {user_id} Error {response.status_code}: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"[!] {user_id} Request failed: {e}")

def run():
    print(f"Testing against {API_BASE_URL}")
    print("=" * 60)
    
    for tc in TEST_CASES:
        print(f"\n=== Running {tc['name']} ===")
        pause_idx = tc.get("pause_after_index", None)
        pause_sec = tc.get("pause_seconds", 0)
        delay = tc.get("delay_between_points_sec", 1.0)
        uid = tc["user_id"]
        
        for i, (lon, lat) in enumerate(tc["route"]):
            send_location_update(uid, lon, lat)
            
            if pause_idx is not None and i == pause_idx:
                print(f"[⏸] Pausing {pause_sec}s to trigger inactivity…")
                time.sleep(pause_sec)
            else:
                time.sleep(delay)
        
        print(f"✓ Completed {tc['name']}")
    
    print("\n" + "=" * 60)
    print("All test cases completed!")

if __name__ == "__main__":
    run()