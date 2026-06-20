import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Default '/admin/' for the VPS (served at game.myonlinejoker.com/admin/).
  // Overridden to '/teen/' for the GitHub Pages preview build via ADMIN_BASE.
  base: process.env.ADMIN_BASE || '/admin/',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
