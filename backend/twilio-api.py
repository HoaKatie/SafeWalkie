# twilio-api.py
import os
from flask import Flask, request, jsonify
from twilio.rest import Client
from dotenv import load_dotenv
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app)

# Twilio credentials
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
# Support both names just in case
TWILIO_NUMBER = os.getenv("TWILIO_PHONE_NUMBER") or os.getenv("TWILIO_FROM_NUMBER")

# Voice + message config
# Voices: "alice" (Twilio’s default) or Amazon Polly voices like "Polly.Joanna", "Polly.Matthew"
TWILIO_VOICE = os.getenv("TWILIO_VOICE", "alice")
ALERT_MESSAGE = os.getenv(
    "TWILIO_GUARDIAN_ALERT_MESSAGE",
    "HELLO, THIS IS AN AUTO GENERATE IMPORTANT CALL. YOU ARE THE GUARDIAN AND THE PERSON IS IN DANGER, PLEASE SEEK HELP IMMEDIATELY."
)

client = Client(TWILIO_SID, TWILIO_TOKEN)

@app.route("/api/call_emergency", methods=["POST"])
def call_emergency():
    try:
        data = request.get_json(force=True)
        phone = data.get("phone")

        if not phone:
            return jsonify({"error": "Missing 'phone' field"}), 400
        if not TWILIO_SID or not TWILIO_TOKEN:
            return jsonify({"error": "Twilio credentials missing"}), 500
        if not TWILIO_NUMBER:
            return jsonify({"error": "TWILIO_PHONE_NUMBER (or TWILIO_FROM_NUMBER) not set"}), 500

        # Build TwiML that repeats the message twice with a pause
        twiml = f"""
<Response>
  <Say voice="{TWILIO_VOICE}">{ALERT_MESSAGE}</Say>
  <Pause length="1"/>
  <Say voice="{TWILIO_VOICE}">{ALERT_MESSAGE}</Say>
</Response>
""".strip()

        call = client.calls.create(
            to=phone,
            from_=TWILIO_NUMBER,
            twiml=twiml
        )

        return jsonify({"message": "Call placed", "call_sid": call.sid}), 200

    except Exception as e:
        # Print to server logs to aid debugging
        print("❌ ERROR during Twilio call:", e)
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # 0.0.0.0 so ngrok can reach it
    app.run(host="0.0.0.0", port=3001)
