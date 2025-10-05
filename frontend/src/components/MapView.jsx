import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView({ destination, mode, setMode, triggerRoute }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const geolocateRef = useRef(null);
  const firstFixRef = useRef(true);
  const trackCoordsRef = useRef([]);
  const watchIdRef = useRef(null); // ✨ ADD
  const [currentCoords, setCurrentCoords] = useState(null);
  const routeLayerId = "route-line";

  const applyPositionUpdate = (map, coords) => { // ✨ ADD
    if (firstFixRef.current) {
      map.jumpTo({ center: coords, zoom: 16 });
      firstFixRef.current = false;
    }

    trackCoordsRef.current.push(coords);
    if (trackCoordsRef.current.length > 1000) trackCoordsRef.current.shift();

    const src = map.getSource("user-track");
    if (src) {
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: trackCoordsRef.current },
          },
        ],
      });
    }

    setCurrentCoords(coords);
  };

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-75.6972, 45.4215],
      zoom: 14,
    });

    mapRef.current = map;

    // Keep existing controls
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    geolocateRef.current = new mapboxgl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
      trackUserLocation: true,
      showUserHeading: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 17 },
    });
    map.addControl(geolocateRef.current, "top-right");

    // Floating Walk/Drive toggle inside the map (unchanged)
    const toggleControl = {
      onAdd: () => {
        const div = document.createElement("div");
        div.className = "mapboxgl-ctrl mode-toggle-map";
        div.innerHTML = `
          <button id="driveBtn" class="mode-btn-map ${
            mode === "driving" ? "active" : ""
          }">🚗 Drive</button>
          <button id="walkBtn" class="mode-btn-map ${
            mode !== "driving" ? "active" : ""
          }">🚶‍♀️ Walk</button>
        `;
        setTimeout(() => {
          const driveBtn = document.getElementById("driveBtn");
          const walkBtn = document.getElementById("walkBtn");

          driveBtn.onclick = () => {
            setMode("driving");
            driveBtn.classList.add("active");
            walkBtn.classList.remove("active");
          };

          walkBtn.onclick = () => {
            setMode("walking");
            walkBtn.classList.add("active");
            driveBtn.classList.remove("active");
          };
        }, 200);
        return div;
      },
      onRemove: () => {},
    };

    map.addControl(toggleControl, "top-left");

    map.on("load", () => {
      // Breadcrumb layer (unchanged)
      map.addSource("user-track", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: [] },
            },
          ],
        },
      });

      map.addLayer({
        id: "user-track-line",
        type: "line",
        source: "user-track",
        paint: {
          "line-color": "#007AFF",
          "line-width": 4,
          "line-opacity": 0.8,
        },
      });

      // Start the control UI (blue dot + heading)
      geolocateRef.current.trigger();

      // ✨ Manual geolocation fallback: ensure currentCoords is always set
      if (navigator.geolocation) {
        // immediate first fix
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            console.log("Fallback first fix:", coords);
            applyPositionUpdate(map, coords);
          },
          (err) => console.error("Fallback getCurrentPosition error:", err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );

        // continuous updates
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            // console.log("Fallback watch fix:", coords);
            applyPositionUpdate(map, coords);
          },
          (err) => console.error("Fallback watchPosition error:", err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
      }
    });

    // GeolocateControl event (kept; logs only)
    geolocateRef.current.on("geolocate", (e) => {
      if (!e || !e.coords) {
        console.warn("Geolocate event missing coords:", e);
        return;
      }
      const coords = [e.coords.longitude, e.coords.latitude];
      console.log("GeolocateControl fix:", coords);
      // We let the control render its own blue dot + heading.
      // Breadcrumb/state is handled by the manual watcher to avoid duplicates.
    });

    geolocateRef.current.on("error", (err) => {
      console.error("Geolocation error:", err);
    });

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current); // ✨ cleanup
      }
      map.remove();
    };
  }, []);

  // Draw route when triggered / mode changes
  useEffect(() => {
    console.log("Attempting to draw route:", { destination, currentCoords, mode, triggerRoute });
    if (!triggerRoute) return; // ⛔ do nothing unless Start Route toggled
    if (!destination || !currentCoords || !mapRef.current) return;
    drawRoute(currentCoords, destination, mode);
  }, [triggerRoute, destination, mode]);


  const drawRoute = async (start, end, profile) => {
    console.log("Fetching directions:", start, "→", end, "profile:", profile);
    const map = mapRef.current;
    if (!map) return;

    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || !data.routes[0]) {
      alert("No route found");
      return;
    }

    console.log("Directions response:", data);

    const route = data.routes[0].geometry;

    if (map.getLayer(routeLayerId)) {
      map.removeLayer(routeLayerId);
      map.removeSource(routeLayerId);
    }

    map.addSource(routeLayerId, {
      type: "geojson",
      data: { type: "Feature", geometry: route },
    });

    map.addLayer({
      id: routeLayerId,
      type: "line",
      source: routeLayerId,
      paint: {
        "line-color": profile === "driving" ? "#007AFF" : "#28a745",
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });

    const bbox = turf.bbox({ type: "Feature", geometry: route });
    map.fitBounds(bbox, { padding: 50 });
  };

  return (
    <div
      ref={mapContainerRef}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
