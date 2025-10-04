import { useState } from 'react';
import './App.css';
import MapView from './components/MapView'; // adjust path to where your MapView.jsx isnpm
import WeatherWidget from './components/WeatherWidget';

function App() {
  // Example backend risk score (0 = safe, 1 = amber, 2 = red)
  const [riskLevel, setRiskLevel] = useState(1); // Replace with API data
  const [riskPosition, setRiskPosition] = useState(40); // % position of slider

  const [destination, setDestination] = useState('');

  const handleSearch = () => {
    alert(`Searching directions to: ${destination}`);
    // Integrate Mapbox/Google Maps API here
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>SAFE WALKIE</h1>
        <p>Your safe navigation assistant</p>
      </header>

      <main>
        {/* Search Bar */}
        <div className="search-container">
          <input
            type="text"
            placeholder="Enter your destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <button onClick={handleSearch}>Start Route</button>
        </div>

         {/* Map Section */}
<div className="map-section">
  <MapView />
</div>


        {/* Features Section */}
        <div className="features">
          {/* Risk Meter */}
          <div className="feature risk-meter">
            <h3>Risk Meter</h3>
            <div className="meter-bar">
              <div className="meter-green"></div>
              <div className="meter-amber"></div>
              <div className="meter-red"></div>
              <div
                className="meter-point"
                style={{ left: `${riskPosition}%` }}
              ></div>
            </div>
            <p className="meter-text">
              {riskLevel === 0
                ? 'Low Risk'
                : riskLevel === 1
                ? 'Moderate Risk'
                : 'High Risk'}
            </p>
          </div>

          {/* Check-in Banner */}
          <div
            className={`feature checkin-banner ${
              riskLevel === 1 ? 'amber' : riskLevel === 2 ? 'red' : ''
            }`}
          >
            {riskLevel === 0 ? (
              <h2 className="safe-text">✅ You are safe</h2>
            ) : (
              <>
                <h3>Check-in Alert</h3>
                <p className="problem-text">
                  ⚠️{' '}
                  {riskLevel === 1
                    ? 'Moderate risk detected! Are you okay?'
                    : 'High risk detected! Are you okay?'}
                </p>
                <div className="checkin-buttons">
                  <button className="ok-btn">I'm OK</button>
                  <button className="need-help-btn">Need Help</button>
                </div>
              </>
            )}
          </div>

{/* Live Weather Feature */}
<div className="feature">
            <WeatherWidget />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer>
        <p>&copy; 2025 Safe Walkie. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
