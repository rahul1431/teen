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
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      // Proxy to the VPS dev environment's nginx, which already fans each
      // /api/<service> prefix out to the right backend port (see
      // /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf_api on
      // the VPS). Hitting localhost:3001 for every prefix was wrong for
      // anything but auth/users/leaderboard — e.g. /api/admin/* has no
      // route on core-api and returned a bare 404 "Not Found".
      '/api': {
        target: 'https://game.myonlinejoker.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
