import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production deployment - no reverse proxy needed
const basePath = process.env.VITE_BASE_URL || '/';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: basePath, // <-- CRITICAL: Dynamic base path for reverse proxy
  server: {
    host: '0.0.0.0', // Listen on all interfaces for Docker/reverse proxy
    port: 5173,
    allowedHosts: [
      'code.berkai.shop',
      'localhost',
      '127.0.0.1'
    ],
    // Configure HMR for reverse proxy
    hmr: {
      port: 5173,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/availability': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/appointments': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Ensure assets work with base path
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
