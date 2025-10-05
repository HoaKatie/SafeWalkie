import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./guardian.css";

/* fix leaflet icons */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

/* create a pulsing divIcon for user live location */
function createPulseIcon() {
  return L.divIcon({
    className: "pulse-icon",
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

export default function GuardianDashboard() {
  const [origin, setOrigin] = useState(null);         // [lat, lng]
  const [destination, setDestination] = useState(null);// [lat, lng]
  const [routeCoords, setRouteCoords] = useState([]); // [[lat,lng],...]
  const [userPos, setUserPos] = useState(null);       // [lat,lng]
  const [userAccuracy, setUserAccuracy] = useState(null); // meters if available
  const pollRef = useRef(null);

  // helper converts backend [lon, lat] -> [lat, lon]
  const lonlatToLatLng = (p) => Array.isArray(p) && p.length >= 2 ? [p[1], p[0]] : null;

  // Apply distress payload (from localStorage)
  const applyDistress = (payload) => {
    if (!payload) return;
    const o = lonlatToLatLng(payload.origin);
    const d = lonlatToLatLng(payload.destination);
    setOrigin(o);
    setDestination(d);

    const r = (payload.route || []).map(lonlatToLatLng).filter(Boolean);
    if (r.length) setRouteCoords(r);
    else if (o && d) setRouteCoords([o, d]);

    // payload.location is current user [lon,lat]
    if (payload.location) {
      const loc = lonlatToLatLng(payload.location);
      setUserPos(loc);
      // some payloads might include accuracy in meters
      if (payload.accuracy) setUserAccuracy(payload.accuracy);
      else setUserAccuracy(null);
    }
  };

  // Read user live location object (last_user_location)
  // expected format: { location: [lon,lat], accuracy?: number, timestamp?: iso }
  const applyUserLive = (raw) => {
    if (!raw) return;
    try {
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!obj) return;
      const loc = obj.location ? lonlatToLatLng(obj.location) : null;
      if (loc) {
        setUserPos(loc);
        setUserAccuracy(obj.accuracy || null);
      }
    } catch (e) { /* ignore parse errors */ }
  };

  useEffect(() => {
    // initial load from last_distress and last_user_location
    try {
      const last = localStorage.getItem("last_distress");
      if (last) applyDistress(JSON.parse(last));
    } catch (e) {}

    try {
      const live = localStorage.getItem("last_user_location");
      if (live) applyUserLive(live);
    } catch (e) {}

    // storage event listener (cross-tab)
    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key === "last_distress" && e.newValue) {
        try { applyDistress(JSON.parse(e.newValue)); } catch {}
      }
      if (e.key === "last_user_location" && e.newValue) {
        try { applyUserLive(e.newValue); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    // Polling every 2s to capture same-tab writes (some environments don't dispatch storage)
    pollRef.current = setInterval(() => {
      try {
        const live = localStorage.getItem("last_user_location");
        if (live) applyUserLive(live);
      } catch (e) {}
    }, 2000);

    return () => {
      window.removeEventListener("storage", onStorage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // center map on userPos if available, else origin or fallback coords
  const center = userPos || origin || [43.6532, -79.3832];

  const pulseIcon = createPulseIcon();

  return (
    <div className="guardian-map-only">
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {/* route polyline if available */}
        {routeCoords && routeCoords.length > 0 && (
          <Polyline positions={routeCoords} pathOptions={{ color: "#ff6b00", weight: 5, dashArray: "6 6" }} />
        )}

        {/* origin/destination markers */}
        {origin && <Marker position={origin} />}
        {destination && <Marker position={destination} />}

        {/* user current location: pulsing marker + optional accuracy circle */}
        {userPos && (
          <>
            <Marker position={userPos} icon={pulseIcon} />
            {userAccuracy && typeof userAccuracy === "number" && (
              <Circle center={userPos} radius={userAccuracy} pathOptions={{ color: "#4da6ff", fillColor: "#4da6ff", opacity: 0.2, fillOpacity: 0.08 }} />
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
