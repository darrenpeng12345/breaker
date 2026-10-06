import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Railway serves the built app with `vite preview` on its own *.up.railway.app domain.
  // Vite blocks unknown hostnames by default ("Blocked request. This host is not allowed"),
  // so allow them.
  preview: {
    host: true,
    allowedHosts: true,
  },
})
