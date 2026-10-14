import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const localesDir = fileURLToPath(new URL('../locales', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@locales': localesDir },
  },
  server: {
    allowedHosts: ['eagledocs.org', 'eagledocs.ai'],
    // Locales are shared with the backend, so they live outside the Vite root.
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || 4000}`,
        changeOrigin: true,
      },
    },
  },
})
