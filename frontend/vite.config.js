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
      // (optional) add other BE routes here:
      // '/update_location': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
})
