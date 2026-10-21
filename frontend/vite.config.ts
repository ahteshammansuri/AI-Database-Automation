import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev:https` serves over https with a self-signed certificate on port 5174. Phones only allow the microphone
// on secure pages, so use it to try Orbit Remote's voice from a phone on the same Wi-Fi (accept the certificate once).
const https = process.env.VITE_DEV_HTTPS === '1'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: '0.0.0.0',
    port: https ? 5174 : 5173,
    strictPort: https,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
      // Reverb WebSocket on the page's own origin (an https page cannot open ws:// to another port).
      '^/app/': {
        target: process.env.VITE_REVERB_PROXY_TARGET || 'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
