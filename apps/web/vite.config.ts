import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: [
      // The liboqs WASM glue is one build shared across Node, browsers and
      // workers. Its Node-only branch never executes in a browser — it is
      // guarded by a `process.versions.node` check — but Rollup still has to
      // resolve the specifiers, so point them at an empty module.
      { find: /^node:(module|fs|path|url)$/, replacement: '/src/shims/empty.ts' },
    ],
  },
  optimizeDeps: {
    // @qmail/crypto is a workspace source dependency, and its vendored WASM
    // must not be run through the CJS interop pre-bundler.
    exclude: ['@qmail/crypto'],
  },
  build: {
    target: 'es2022',
  },
});
