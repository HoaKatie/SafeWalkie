import { useState } from 'react';
import './App.css';
import MapView from "./components/MapView.jsx";

function App() {
  const [destination, setDestination] = useState('');

  const handleSearch = () => {
    alert(`Searching directions to: ${destination}`);
    // Later integrate Mapbox/Google Maps API here
  };

  return (
    <div className="app">
      <header className="header">
        <h1>SAFE WALKIE</h1>
        <p>Walk safe</p>
      </header>

      <main>
        <div className="search-container">
          <input
            type="text"
            placeholder="Enter your destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <button onClick={handleSearch}>Start</button>
        </div>

        <div className="map-placeholder">
          <p>Map will appear here</p>
        </div>

        <div className="features">
          <div className="feature risk-meter">
  <h3>Risk Meter</h3>
  <div className="meter-bar">
    <div
      className="meter-point"
      style={{ left: '40%' }} // Example: slider position; later bind to backend risk score
    ></div>
    <div className="meter-green"></div>
    <div className="meter-amber"></div>
    <div className="meter-red"></div>
  </div>
  <p className="meter-text">Moderate Risk</p> {/* Later bind to backend message */}
</div>

         <div className="feature checkin-banner">
  <h3>Check-in Alert</h3>
  <p className="problem-text">⚠️ Detour ahead! Are you okay?</p>
  <div className="checkin-buttons">
    <button className="ok-btn">I'm OK</button>
    <button className="need-help-btn">Need Help</button>
  </div>
</div>

          <div className="feature">
            <h3>Offline Mode</h3>
            <p>Access maps even without internet.</p>
          </div>
        </div>
      </main>

      <footer>
        <p>&copy; 2025 NavGuide. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
