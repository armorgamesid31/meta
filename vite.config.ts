import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production deployment - no reverse proxy needed
const basePath = process.env.VITE_BASE_URL || '/';

export default defineConfig({
  plugins: [react()],
  base: basePath,
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'code.berkai.shop',
      'localhost',
      '127.0.0.1'
    ],
    hmr: {
      port: 5173,
      overlay: false,
    },
    middlewareMode: false,
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
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  css: {
    postcss: null,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
