import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Whether to polyfill specific globals.
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Whether to polyfill Node.js built-in modules.
      protocolImports: true,
    }),
  ],
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
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: [
      '@railgun-community/wallet',
      '@railgun-community/shared-models',
      'localforage',
      'level-js',
      'snarkjs'
    ],
    exclude: ['@railgun-community/wallet/dist/cjs']
  },
  define: {
    global: 'globalThis',
  },
  base: '/'
}) 