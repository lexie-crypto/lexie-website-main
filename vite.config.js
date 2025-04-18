import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: '0.0.0.0',
    strictPort: true,
    hmr: {
      host: 'localhost'
    },
    cors: true,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '3b8b-216-144-93-116.ngrok-free.app',
      '.ngrok-free.app'  // Allow all ngrok-free.app subdomains for future tunnels
    ]
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  base: '/'
}) 