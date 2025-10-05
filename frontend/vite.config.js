import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fix Mapbox compatibility with Vite
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['mapbox-gl']
  },
  define: {
    'process.env': {}
  },
  server: {
    proxy: {
      // forward FE calls to Flask during dev
      '/start_walk': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        // secure: false, // uncomment if your BE uses self-signed https
      },
       '/update_location': { target: 'http://localhost:5001', changeOrigin: true },
        '/risk/latest': { target: 'http://localhost:5001', changeOrigin: true },
        '/risk_update':  { target: 'http://localhost:5001', changeOrigin: true },

    },
    host: true,
    allowedHosts: [
      'hypolimnial-stilted-ashley.ngrok-free.dev',  // add your current Ngrok hostname here
      // You can add more allowed hosts here if needed
    ],
    cors: true,
  },
})
