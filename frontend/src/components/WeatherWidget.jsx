import { useState, useEffect } from 'react';
import '../App.css';

function App() {
  const [weather, setWeather] = useState({ temp: null, condition: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;

        try {
          const apiKey = '7dc8e03fe07a4276af4193226250410';
          const response = await fetch(
            `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${latitude},${longitude}`
          );
          const data = await response.json();

          setWeather({
            temp: data.current.temp_c,           // Temperature in Celsius
            condition: data.current.condition.text, // e.g., Rain, Sunny, Fog
          });
          setLoading(false);
        } catch (err) {
          console.error('Weather API error:', err);
          setLoading(false);
        }
      });
    } else {
      alert('Geolocation is not supported by your browser.');
      setLoading(false);
    }
  }, []);

  return (
    <div className="weather-card">
      {loading ? (
        <p>Loading weather...</p>
      ) : (
        <>
          <h3>Current Weather</h3>
          <p>Temperature: {weather.temp}°C</p>
          <p>Condition: {weather.condition}</p>
        </>
      )}
    </div>
  );
}

export default App;
