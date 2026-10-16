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
    // The dev server is for development only: never route a public production hostname to it.
    allowedHosts: ['studyhawk.app', 'eagledocs.org', 'eagledocs.ai'],
    // Locales are shared with the backend, so they live outside the Vite root. Only that folder:
    // the repo root also holds data/ (the dev database and dev-master.key), which /@fs/ must never serve.
    fs: { allow: ['.', '../locales'] },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || 4000}`,
        changeOrigin: true,
      },
      // OAuth and MCP for ChatGPT, Claude and MCP Inspector (the consent screen itself stays in the app).
      '^/(mcp|oauth/(authorize|token|register|revoke)|\\.well-known/(oauth-|openid-))': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || 4000}`,
        changeOrigin: true,
      },
    },
  },
})
