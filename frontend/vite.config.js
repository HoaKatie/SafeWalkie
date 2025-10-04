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
  }
})
