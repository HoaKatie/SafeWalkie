// src/components/GuardianDashboard.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "./guardian.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

export default function GuardianDashboard({ style = "mapbox://styles/mapbox/streets-v11" }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ origin: null, destination: null, user: null });
  const routeSourceId = "route-source";

  const [userPhone, setUserPhone] = useState("");

  const validLonLat = (p) => Array.isArray(p) && p.length >= 2 ? [p[0], p[1]] : null;

  useEffect(() => {
    if (!mapboxgl.accessToken) {
      console.error("Mapbox token is missing. Set VITE_MAPBOX_TOKEN in your .env");
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style,
      center: [-79.3832, 43.6532],
      zoom: 14,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      if (!map.getSource(routeSourceId)) {
        map.addSource(routeSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: routeSourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ff6b00", "line-width": 5, "line-dasharray": [2, 1.5] },
        });
      }
    });

    const setDomMarker = (id, lonlat, className) => {
      if (markersRef.current[id]) {
        markersRef.current[id].setLngLat(lonlat);
        return;
      }
      const el = document.createElement("div");
      el.className = className;
      markersRef.current[id] = new mapboxgl.Marker(el).setLngLat(lonlat).addTo(map);
    };

    const applyPayload = (payload) => {
      if (!payload) return;

      if (payload.origin) {
        const o = validLonLat(payload.origin);
        if (o && map) setDomMarker("origin", o, "mb-origin-marker");
      }
      if (payload.destination) {
        const d = validLonLat(payload.destination);
        if (d && map) setDomMarker("destination", d, "mb-destination-marker");
      }
      const route = (payload.route && payload.route.length) ? payload.route.filter(Array.isArray) : null;
      if (route && route.length && map.getSource(routeSourceId)) {
        map.getSource(routeSourceId).setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: route } }],
        });
      }
      if (payload.location) {
        const user = validLonLat(payload.location);
        if (user) {
          if (!markersRef.current.user) {
            const el = document.createElement("div");
            el.className = "mb-pulse-marker";
            markersRef.current.user = new mapboxgl.Marker(el, { anchor: "center" }).setLngLat(user).addTo(map);
          } else {
            markersRef.current.user.setLngLat(user);
          }
          try { map.easeTo({ center: user, offset: [0, -80], duration: 800 }); } catch {}
        }
      }
      if (payload.phone) setUserPhone(payload.phone);
    };

    try {
      const raw = localStorage.getItem("last_distress");
      if (raw) {
        applyPayload(JSON.parse(raw));
      } else {
        const live = localStorage.getItem("last_user_location");
        if (live) {
          const parsed = JSON.parse(live);
          if (parsed && parsed.location) applyPayload({ location: parsed.location, phone: parsed.phone });
        }
      }
    } catch (e) { console.warn("Failed to parse localStorage initial values", e); }

    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key === "last_distress" && e.newValue) {
        try { applyPayload(JSON.parse(e.newValue)); } catch {}
      }
      if (e.key === "last_user_location" && e.newValue) {
        try { const obj = JSON.parse(e.newValue); if (obj && obj.location) applyPayload({ location: obj.location, phone: obj.phone }); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    const poll = setInterval(() => {
      try {
        const live = localStorage.getItem("last_user_location");
        if (live) {
          const parsed = JSON.parse(live);
          if (parsed && parsed.location) applyPayload({ location: parsed.location, phone: parsed.phone });
        }
      } catch (e) {}
    }, 2000);

    return () => {
      clearInterval(poll);
      window.removeEventListener("storage", onStorage);
      Object.values(markersRef.current).forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = {};
      if (mapRef.current) { try { mapRef.current.remove(); } catch {} }
    };
  }, [style]);

  return (
    <div className="guardian-mapbox-wrapper">
      <div ref={mapContainer} className="guardian-mapbox-container" />
      <div className="guardian-user-info">
        <h3>User Phone:</h3>
        <p>{userPhone || "guadian phone number"}</p> // Placeholder if no phone
      </div>
    </div>
  );
}
