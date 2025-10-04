from flask import Flask

app = Flask(__name__)

@app.route('/')
def home():
    return "Hello from Flask!"

# Message queue for real time data update
# End points for 
    # 1. Find best path 
    # 2. Set route
    # 3. Start 

# Real time update: 
    # 1. End point to capture real-time location update (using message queue)
    # 2. 
### 

if __name__ == '__main__':
    # You can change host/port if needed
    app.run(debug=True)
