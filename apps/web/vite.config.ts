import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // The crypto package is a workspace source dependency; Vite must not try to
  // pre-bundle it as a CJS external, and the liboqs WASM glue must stay ESM.
  optimizeDeps: {
    exclude: ['@qmail/crypto', '@oqs/liboqs-js'],
  },
  build: {
    target: 'es2022',
  },
});
