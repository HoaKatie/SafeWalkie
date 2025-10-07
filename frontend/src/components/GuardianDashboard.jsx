// src/components/GuardianDashboard.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "./guardian.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

export default function GuardianDashboard({ style = "mapbox://styles/mapbox/streets-v11" }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ origin: null, destination: null, user: null, guardian: null });
  const routeSourceId = "route-source";
  const [mapReady, setMapReady] = useState(false);
  const [userPhone, setUserPhone] = useState("");

  const validLonLat = (p) => (Array.isArray(p) && p.length >= 2 ? [p[0], p[1]] : null);

  useEffect(() => {
    if (!mapboxgl.accessToken) {
      console.error("Mapbox token missing");
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style,
      center: [-79.3832, 43.6532],
      zoom: 13,
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
      setMapReady(true);
    });

    const setDomMarker = (id, lonlat, className) => {
      if (!mapReady || !mapRef.current) return; // wait for map to load
      const map = mapRef.current;
      if (markersRef.current[id]) {
        markersRef.current[id].setLngLat(lonlat);
      } else {
        const el = document.createElement("div");
        el.className = className;
        markersRef.current[id] = new mapboxgl.Marker(el).setLngLat(lonlat).addTo(map);
      }
    };

    const applyPayload = (payload) => {
      if (!payload || !mapReady) return;
      if (payload.origin) {
        const o = validLonLat(payload.origin);
        if (o) setDomMarker("origin", o, "mb-origin-marker");
      }
      if (payload.destination) {
        const d = validLonLat(payload.destination);
        if (d) setDomMarker("destination", d, "mb-destination-marker");
      }
      const route =
        payload.route && payload.route.length
          ? payload.route.filter(Array.isArray)
          : null;
      if (route && map.getSource(routeSourceId)) {
        map.getSource(routeSourceId).setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: route } }],
        });
      }
      if (payload.location) {
        const user = validLonLat(payload.location);
        if (user) {
          setDomMarker("user", user, "mb-pulse-marker");
        }
      }
      if (payload.phone) setUserPhone(payload.phone);
    };

    // Load last known distress once the map is ready
    const checkStored = () => {
      try {
        const raw = localStorage.getItem("last_distress");
        if (raw) applyPayload(JSON.parse(raw));
      } catch (e) {
        console.warn("Parse localStorage fail", e);
      }
    };

    const onStorage = (e) => {
      if (!e.key) return;
      if (e.key === "last_distress" && e.newValue) {
        try {
          applyPayload(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);

    // 🛰️ Guardian’s own live location (after map ready)
    const initGuardianLocation = () => {
      if (!navigator.geolocation) return;
      let watchId = null;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = [pos.coords.longitude, pos.coords.latitude];
          setDomMarker("guardian", coords, "mb-guardian-marker");
          map.flyTo({ center: coords, zoom: 14, duration: 1000 });
        },
        (err) => console.warn("Guardian initial location failed:", err),
        { enableHighAccuracy: true }
      );

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = [pos.coords.longitude, pos.coords.latitude];
          setDomMarker("guardian", coords, "mb-guardian-marker");
          if (mapRef.current) {
            mapRef.current.easeTo({ center: coords, duration: 800 });
          }
        },
        (err) => console.warn("Guardian location watch error:", err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );

      return () => navigator.geolocation.clearWatch(watchId);
    };

    // Wait for map ready before starting geolocation + data load
    const readyWatcher = setInterval(() => {
      if (mapReady) {
        clearInterval(readyWatcher);
        checkStored();
        initGuardianLocation();
      }
    }, 300);

    return () => {
      clearInterval(readyWatcher);
      window.removeEventListener("storage", onStorage);
      Object.values(markersRef.current).forEach((m) => m?.remove());
      if (mapRef.current) mapRef.current.remove();
    };
  }, [style, mapReady]);

  return (
    <div className="guardian-mapbox-wrapper">
      <div ref={mapContainer} className="guardian-mapbox-container" />
      <div className="guardian-user-info">
        <h3>User Phone:</h3>
        <p>{userPhone || "+15419398606"}</p>
      </div>
    </div>
  );
}
