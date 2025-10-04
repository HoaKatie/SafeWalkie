import { useState, useRef, useEffect } from 'react';
import './App.css';
import MapView from './components/MapView';
import WeatherWidget from './components/WeatherWidget';

function App() {
  const [riskLevel, setRiskLevel] = useState(1); // example risk
  const [riskPosition, setRiskPosition] = useState(40);
  const [destination, setDestination] = useState('');

  // Safe word states
  const [safeWord, setSafeWord] = useState('help'); // default safe word
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  // Search function
  const handleSearch = () => {
    alert(`Searching directions to: ${destination}`);
    // Integrate Mapbox/Google Maps API here
  };

  // Emergency action
  const handleEmergency = (silent = false) => {
    // Put emergency.mp3 in your public/ folder so it's available at /emergency.mp3
    const audio = new Audio('/emergency.mp3');
    audio.play().catch((err) => console.log('Audio play error:', err));
    if (!silent) alert('Emergency activated!');
  };

  // Toggle speech recognition (Safe Word)
  const toggleSafeWord = () => {
    // Browser support check
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Your browser does not support the Web Speech API (SpeechRecognition). Use Chrome/Edge for best support.');
      return;
    }

    if (listening) {
      // Stop listening
      try {
        recognitionRef.current?.stop();
      } catch (e) {
        console.warn('Error stopping recognition:', e);
      }
      setListening(false);
    } else {
      // Start listening
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();

      recognition.continuous = true; // keep listening
      recognition.lang = 'en-US';
      recognition.interimResults = false; // only final transcripts
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript.trim().toLowerCase();
            console.log('Speech result:', transcript);
            // match safe word (case-insensitive). use includes for phrase match
            if (safeWord && transcript.includes(safeWord.trim().toLowerCase())) {
              // trigger emergency (silent=false shows alert + plays sound)
              handleEmergency();
            }
          }
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event);
        // optionally stop listening on fatal errors
      };

      recognition.onend = () => {
        // If still supposed to be listening, restart (helps with some browsers stopping)
        if (listening) {
          try {
            recognition.start();
          } catch (e) {
            console.warn('Failed to restart recognition:', e);
          }
        }
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
        setListening(true);
      } catch (e) {
        console.error('Failed to start recognition:', e);
        alert('Could not start voice recognition. Check microphone permissions.');
      }
    }
  };

  // Cleanup on unmount: stop recognition if running
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch (e) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>SAFE WALKIE</h1>
        <p>Your safe navigation assistant</p>
      </header>

      <main>
        {/* Search Bar + Buttons + Safe Word input */}
        <div className="search-container">
          <input
            type="text"
            placeholder="Enter your destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          <div className="search-buttons">
            <button onClick={handleSearch}>Start Route</button>

            <button className="emergency-btn" onClick={() => handleEmergency()}>
              🚨 Emergency
            </button>

            {/* Safe Word toggle button */}
            <button
              className={`safe-word-btn ${listening ? 'active' : ''}`}
              onClick={toggleSafeWord}
            >
              {listening ? 'Safe Word ON' : 'Safe Word OFF'}
            </button>
          </div>

          {/* Safe word setter (user can change the phrase) */}
          <div className="safe-word-setup">
            <label htmlFor="safeWordInput">Safe word:</label>
            <input
              id="safeWordInput"
              type="text"
              value={safeWord}
              onChange={(e) => setSafeWord(e.target.value)}
              placeholder="Type your safe word (e.g. help)"
            />
            <small className="hint">When listening, saying this word triggers the emergency.</small>
          </div>
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
              <div className="meter-point" style={{ left: `${riskPosition}%` }} />
            </div>
            <p className="meter-text">
              {riskLevel === 0 ? 'Low Risk' : riskLevel === 1 ? 'Moderate Risk' : 'High Risk'}
            </p>
          </div>

          {/* Check-in Banner */}
          <div className={`feature checkin-banner ${riskLevel === 1 ? 'amber' : riskLevel === 2 ? 'red' : ''}`}>
            {riskLevel === 0 ? (
              <h2 className="safe-text">✅ You are safe</h2>
            ) : (
              <>
                <h3>Check-in Alert</h3>
                <p className="problem-text">
                  ⚠️ {riskLevel === 1 ? 'Moderate risk detected! Are you okay?' : 'High risk detected! Are you okay?'}
                </p>
                <div className="checkin-buttons">
                  <button className="ok-btn">I'm OK</button>
                  <button className="need-help-btn">Need Help</button>
                </div>
              </>
            )}
          </div>

          {/* Weather Widget */}
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
