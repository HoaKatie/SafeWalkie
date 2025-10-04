import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css"; // <-- important for controls/UI

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const geolocateRef = useRef(null);
  const firstFixRef = useRef(true);
  const trackCoordsRef = useRef([]); // store your breadcrumb path

  useEffect(() => {
    // 1) Init map
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-75.6972, 45.4215], // default center (Ottawa)
      zoom: 14
    });
    mapRef.current = map;

    // 2) Controls
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // 3) Add geolocate control (does live tracking + heading + accuracy)
    geolocateRef.current = new mapboxgl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        maximumAge: 0,     // never use cached position
        timeout: 10000
      },
      trackUserLocation: true, // keep following as you move
      showUserHeading: true,   // little arrow on the dot
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 17 } // prevent over-zooming
    });
    map.addControl(geolocateRef.current, "top-right");

    // 4) When map style is ready,:
    //    - create an empty GeoJSON line for breadcrumb
    //    - trigger geolocation immediately
    map.on("load", () => {
      // Breadcrumb source + layer
      map.addSource("user-track", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: [] }
            }
          ]
        }
      });

      map.addLayer({
        id: "user-track-line",
        type: "line",
        source: "user-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#007AFF",
          "line-width": 4,
          "line-opacity": 0.8
        }
      });

      // Kick off geolocation (will prompt for permission)
      geolocateRef.current.trigger();
    });

    // 5) Whenever a geolocation fix arrives, update camera once
    //    and append to the breadcrumb line
    geolocateRef.current.on("geolocate", (e) => {
      const { latitude, longitude } = e.coords;
      const coords = [longitude, latitude];

      // Jump to first fix
      if (firstFixRef.current) {
        map.jumpTo({ center: coords, zoom: 16 });
        firstFixRef.current = false;
      }

      // Append to track (limit to last ~1000 points to keep it light)
      trackCoordsRef.current.push(coords);
      if (trackCoordsRef.current.length > 1000) {
        trackCoordsRef.current.shift();
      }

      // Update line data
      const src = map.getSource("user-track");
      if (src) {
        src.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: trackCoordsRef.current
              }
            }
          ]
        });
      }
      // NOTE: When the GeolocateControl is "tracking", the camera will follow you.
      // If you want to force smooth follow anyway, uncomment:
      // map.easeTo({ center: coords, duration: 800 });
    });

    // 6) Clean up
    return () => {
      map.remove();
    };
  }, []);

  return (
    <div
      ref={mapContainerRef}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
