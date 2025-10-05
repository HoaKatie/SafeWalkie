import { useState, useRef, useEffect } from 'react';
import './App.css';
import MapView from './components/MapView';
import WeatherWidget from './components/WeatherWidget';
import GuardianDashboard from "./components/GuardianDashboard";

function App() {
  const [riskLevel, setRiskLevel] = useState(1);
  const [riskPosition, setRiskPosition] = useState(40);
  const [destination, setDestination] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState(null);
  const [triggerRoute, setTriggerRoute] = useState(false);
  const [mode, setMode] = useState("driving"); // driving | walking
  const [userLocation, setUserLocation] = useState(null);

  const emergencyAudioRef = useRef(null);
  const [emergencyOn, setEmergencyOn] = useState(false);
  const [emergencyPhone, setEmergencyPhone] = useState("6135012873"); // hardcoded for now
  // onChange={(e) => setEmergencyPhone(e.target.value)} // FOR LATER OK???


  const [userPhone, setUserPhone] = useState("+1-416-555-0000"); // user phone shown to guardian
  const [sessionId, setSessionId] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null); // [[lon,lat], ...] from BE

  // modal + emergency states
  const [showNeedHelpModal, setShowNeedHelpModal] = useState(false);
  const [emergencyPhones, setEmergencyPhones] = useState([
    { id: 1, label: "Police (default)", number: "+112" },
    { id: 2, label: "Local Security", number: "+1-416-555-0000" },
    { id: 3, label: "Guardian Hotline", number: "+1-416-555-1111" },
  ]);

  // guardian view full-screen toggle
  const [showGuardian, setShowGuardian] = useState(false);

  function getOrCreateClientId() {
    let id = localStorage.getItem("client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("client_id", id);
    }
    return id;
  }
  const clientId = getOrCreateClientId();
  
  // translate score → UI level/position
  function scoreToUi(score) {
    const level = score <= 24 ? 0 : score <= 59 ? 1 : 2; // 0=green,1=amber,2=red
    const pos = Math.max(0, Math.min(100, score));       // 0–100%
    console.log(`Risk score ${score} → level ${level}, pos ${pos}%`);
    return { level, pos };
  }

  const [riskScore, setRiskScore] = useState(0);


  useEffect(() => {
    return () => {
      if (emergencyAudioRef.current) {
        emergencyAudioRef.current.pause();
        emergencyAudioRef.current.currentTime = 0;
      }
    };
  }, []);
  // simulate/sync interval ref for live updates when help active
  const liveIntervalRef = useRef(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords;
          setUserLocation({ longitude, latitude });
          console.log('User location set for search proximity:', pos.coords);
        },
        (err) => console.warn('Geolocation failed for search proximity:', err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      console.warn('Geolocation not supported in this browser.');
    }
  }, []);


  
  // Autocomplete from Mapbox Geocoding API
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (destination.length < 3) {
        setSuggestions([]);
        setOpenSuggestions(false);
        return;
      }

      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        destination
      )}.json?access_token=${token}&autocomplete=true&limit=5`;

      if (userLocation) {
        url += `&proximity=${userLocation.longitude},${userLocation.latitude}`;
        url += `&country=ca`;
      }

      try {
        const res = await fetch(url);
        const data = await res.json();
        setSuggestions(data.features || []);
      } catch (e) {
        console.warn("Failed to fetch suggestions", e);
      }
    };
    fetchSuggestions();
  }, [destination, userLocation]);

  const handleSelect = (place) => {
    setDestination(place.place_name);
    setSelectedCoords(place.geometry.coordinates);
    setOpenSuggestions(false);
    setSuggestions([]);
    setTriggerRoute(false);
    console.log('Selected place:', place);
  };

  async function startWalkFlow() {
    if (!userLocation) {
      alert("Waiting for your current location...");
      return;
    }
    if (!selectedCoords) {
      alert("Please choose a valid destination from the suggestions.");
      return;
    }

    const payload = {
      user_id: clientId,
      start_location: [userLocation.longitude, userLocation.latitude],
      end_location: selectedCoords
    };

    try {
      const res = await fetch("/start_walk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Backend error ${res.status}`);
      }

      const json = await res.json(); // expecting { walking_session_id, route: [[lon,lat], ...] }
      setSessionId(json.walking_session_id);
      setRouteCoords(json.route || null);
    } catch (e) {
      console.warn("startWalkFlow failed, using simulated route", e);
      // fallback: generate simulated route (lon,lat pairs)
      const simRoute = generateStraightRoute([userLocation.longitude, userLocation.latitude], selectedCoords, 20);
      setSessionId(`sim-${Date.now()}`);
      setRouteCoords(simRoute);
    }
  }

  // Safe word and recognition (unchanged)
  const [safeWord, setSafeWord] = useState('help');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const handleSearch = () => {
    if (!selectedCoords) {
      console.warn("No coordinates selected from suggestions.");
      window.alert("⚠️ Please select an address from the dropdown first.");
      return;
    }

    setTriggerRoute((prev) => !prev);
    setSuggestions([]);
    startWalkFlow();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      console.log("Enter key pressed — ignored. Use Start Route button instead.");
    }
  };

  // 🔔 Trigger emergency call (supports tel: for now, Twilio later)
  const triggerEmergencyCall = async () => {
    try {
      if (/Mobi|Android/i.test(navigator.userAgent)) {
        // On mobile browser: open native dialer directly
        window.location.href = `tel:${emergencyPhone}`;
      } else {
        // On desktop: show simulated call or later use Twilio
        console.log("Desktop environment detected — preparing backend/Twilio call...");
        // placeholder for backend call (when you enable Twilio)
        // await fetch('/api/call_emergency', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ phone: emergencyPhone })
        // });
        alert(`Simulated call to ${emergencyPhone}`);
      }
    } catch (err) {
      console.error("Error triggering call:", err);
    }
  };



  // Emergency action
  const ensureEmergencyAudio = () => {
    if (!emergencyAudioRef.current) {
      const audio = new Audio('/emergency.mp3');
      audio.loop = true; // keep sounding until toggled off
      emergencyAudioRef.current = audio;
    }
    return emergencyAudioRef.current;
  };

  // Force ON (safe word can call this)
  const handleEmergency = () => {
    const audio = ensureEmergencyAudio();
    audio.play().catch((err) => console.log('Audio play error:', err));
    setEmergencyOn(true);
    // Trigger simulated call
    triggerEmergencyCall();
  };

  // Button uses this to toggle ON/OFF
  const toggleEmergency = () => {
    const audio = ensureEmergencyAudio();
    if (!emergencyOn) {
      audio.play().catch((err) => console.log('Audio play error:', err));
      setEmergencyOn(true);
      // Trigger simulated call
      triggerEmergencyCall();
    } else {
      audio.pause();
      audio.currentTime = 0; // reset to start
      setEmergencyOn(false);
    }
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
              // Immediately trigger emergency sound (no popup alert)
              handleEmergency(true);
            }

            // For debugging: print every recognized word/phrase to console
            console.log(`[Speech Debug] Heard: "${transcript}"`);

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

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
      // clear live interval if any
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;           // wait until /start_walk returns
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/risk/latest?sid=${sessionId}`);
        if (!res.ok) return;
        const json = await res.json();   // { riskScore: number }
        if (typeof json.riskScore === 'number') {
          setRiskScore(json.riskScore);
          const { level, pos } = scoreToUi(json.riskScore);
          setRiskLevel(level);
          setRiskPosition(pos);
        }
      } catch (e) {
        // ignore transient network errors
      }
    }, 3000); // poll every 3s

    return () => clearInterval(t);
  }, [sessionId]);

   // ---------- NEW: helpers for Need Help -> notify guardians & broadcast via localStorage ----------
  function callNumber(number) {
    const raw = number.replace(/\s+/g, "");
    window.open(`tel:${raw}`, "_self");
  }

  // build payload for distress event
  function buildDistressPayload(reason = "manual_need_help") {
    const origin = userLocation ? [userLocation.longitude, userLocation.latitude] : null;
    const payload = {
      type: "distress",
      userId: clientId,
      sessionId: sessionId || `session-${Date.now()}`,
      phone: userPhone,
      origin: origin, // [lon,lat]
      destination: selectedCoords || null, // [lon,lat]
      route: routeCoords || null, // [[lon,lat],...]
      reason,
      timestamp: new Date().toISOString(),
    };
    return payload;
  }

  // notify backend (best-effort) and write localStorage copy for GuardianDashboard demo
  async function notifyGuardians(payload) {
    // write to localStorage so guardian UI in same browser sees it live (demo adapter)
    try {
      localStorage.setItem("last_distress", JSON.stringify(payload));
    } catch (e) {
      console.warn("failed to write distress to localStorage", e);
    }

    // try backend endpoint (non-blocking)
    try {
      await fetch("/api/notify_guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("notify_guardians request failed (server may be missing):", e);
    }
  }

  // When need help is triggered: open modal, notify backend, and start broadcasting live location updates
  const handleNeedHelp = async () => {
    setShowNeedHelpModal(true);
    const payload = buildDistressPayload("manual_need_help");
    await notifyGuardians(payload);
    startLiveLocationBroadcast(payload);
  };

  // broadcast simulated live location updates along route to localStorage so GuardianDashboard reads them
  function startLiveLocationBroadcast(initialPayload) {
    // clear previous interval if any
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }

    const route = initialPayload.route && initialPayload.route.length ? initialPayload.route : (
      initialPayload.destination && initialPayload.origin ? generateStraightRoute(initialPayload.origin, initialPayload.destination, 20) : null
    );

    if (!route || route.length === 0) {
      // If no route, just write one snapshot (current location)
      try {
        localStorage.setItem("last_distress", JSON.stringify(initialPayload));
      } catch (e) {}
      return;
    }

    // convert route (lon,lat) -> array of points to step through
    const points = route.map(pt => Array.isArray(pt) ? pt : null).filter(Boolean);

    let i = 0;
    // update every 3s
    liveIntervalRef.current = setInterval(() => {
      i = Math.min(i + 1, points.length - 1);
      const lonlat = points[i];
      // update app's userLocation (used by user map)
      setUserLocation({ longitude: lonlat[0], latitude: lonlat[1] });

      // update payload and write to localStorage for guardians
      const updated = {
        ...initialPayload,
        location: lonlat, // current [lon,lat]
        timestamp: new Date().toISOString()
      };
      try {
        localStorage.setItem("last_distress", JSON.stringify(updated));
      } catch (e) {}
      // if reached end, keep broadcasting last location (or clear interval if you prefer)
      if (i >= points.length - 1) {
        // stop auto-advance but keep last location present
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }, 3000);
  }

  // helper: generate simple straight route between two lonlat points (backend expects [[lon,lat],...])
  function generateStraightRoute(aLonLat, bLonLat, n = 20) {
    const aLon = aLonLat[0], aLat = aLonLat[1];
    const bLon = bLonLat[0], bLat = bLonLat[1];
    const arr = [];
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      arr.push([aLon + (bLon - aLon) * t + (Math.random() - 0.5) * 0.0002, aLat + (bLat - aLat) * t + (Math.random() - 0.5) * 0.0002]);
    }
    return arr;
  }

  // -------------- RENDER --------------
  // If guardian view requested → show full-screen GuardianDashboard
  if (showGuardian) {
    return (
      <div style={{ height: "100vh" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#091029", color: "#fff" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <strong>SafeWalkie — Guardian</strong>
            <span style={{ fontSize: 13, color: "#cbd5e1" }}>Dashboard</span>
          </div>
          <div>
            <button onClick={() => setShowGuardian(false)} style={{ marginRight: 8, padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Go to User App</button>
            <button onClick={() => { /* refresh */ window.location.reload(); }} style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>Refresh</button>
          </div>
        </div>

        <GuardianDashboard wsUrl={null} />
      </div>
    );
  }

  // Default: user UI
  return (
    <div className="app">
      {/* Header */}
      <header className="header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1>SAFE WALKIE</h1>
          <p>Your safe navigation assistant</p>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* quick guardian toggle for testing */}
          <button onClick={() => setShowGuardian(true)} style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>
            Open Guardian Dashboard
          </button>

          
        </div>
      </header>

      <main>
        {/* Search Bar + Buttons + Safe Word input */}
        <div className="search-container">
          {/* Emergency Contact Number setup */}
          <div className="emergency-contact-setup">
            <label htmlFor="emergencyPhone">Emergency Phone:</label>
            <input
              id="emergencyPhone"
              type="tel"
              placeholder="Enter phone number"
              // we can ignore actual input value for now, use dummy
              onChange={(e) => console.log("Entered phone number:", e.target.value)}
            />
            <button onClick={() => alert("Phone saved (demo only)")}>Save</button>
          </div>

          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Enter your destination"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setOpenSuggestions(true);
              }}
              onKeyDown={handleKeyDown}
            />
            {openSuggestions && suggestions.length > 0 && (
              <ul className="suggestions-dropdown">
                {suggestions.map((s) => (
                  <li key={s.id} onClick={() => handleSelect(s)}>
                    {s.place_name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="search-buttons">
            <button onClick={handleSearch}>Start Route</button>

            <button className="emergency-btn" onClick={toggleEmergency}>
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
          <MapView
            destination={selectedCoords}
            mode={mode}
            setMode={setMode}
            triggerRoute={triggerRoute}
            // pass userLocation so MapView can show user's live location
            userLocation={userLocation}
          />
        </div>

        {/* Feature Section */}
        <div className="features">
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
                  {/* <-- THIS triggers the Need Help flow (user-side) */}
                  <button className="need-help-btn" onClick={handleNeedHelp}>Need Help</button>
                </div>
              </>
            )}
          </div>

          <div className="feature">
            <WeatherWidget />
          </div>
        </div>
      </main>

      {/* Need Help modal (user side) */}
      {showNeedHelpModal && (
        <div className="needhelp-modal-overlay" onClick={() => {
          setShowNeedHelpModal(false);
          if (liveIntervalRef.current) {
            clearInterval(liveIntervalRef.current);
            liveIntervalRef.current = null;
          }
        }}>
          <div className="needhelp-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Emergency contacts</h3>
            <p>Select a number to call immediately, or close to stay safe.</p>

            <div className="needhelp-phones">
              {emergencyPhones.map((p) => (
                <button
                  key={p.id}
                  className="needhelp-phone-card"
                  onClick={() => {
                    callNumber(p.number);
                    setShowNeedHelpModal(false);
                    if (liveIntervalRef.current) {
                      clearInterval(liveIntervalRef.current);
                      liveIntervalRef.current = null;
                    }
                  }}
                >
                  <div>
                    <strong>{p.label}</strong>
                    <div className="phone-small">{p.number}</div>
                  </div>
                  <div className="call-emoji">📞</div>
                </button>
              ))}
            </div>

            <div className="needhelp-actions">
              <button className="small" onClick={() => {
                setShowNeedHelpModal(false);
                if (liveIntervalRef.current) {
                  clearInterval(liveIntervalRef.current);
                  liveIntervalRef.current = null;
                }
              }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <footer>
        <p>&copy; 2025 Safe Walkie. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
