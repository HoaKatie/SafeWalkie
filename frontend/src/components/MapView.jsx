import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView() {
  const mapContainer = useRef(null);

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-75.6972, 45.4215], // Ottawa :)
      zoom: 12
    });

    return () => map.remove();
  }, []);

  return <div ref={mapContainer} style={{ height: "100vh", width: "100%" }} />;
}
