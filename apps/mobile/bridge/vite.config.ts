import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the WebView crypto host into a single self-contained IIFE.
 *
 * It has to be one file with no imports and no network fetches, because it is
 * handed to the WebView as an inline HTML string — there is no origin to load
 * anything else from. The liboqs WASM is already embedded in its glue as a
 * string literal, so the whole thing really does fit in one bundle.
 */
export default defineConfig({
  resolve: {
    alias: [
      // The liboqs glue is one build shared across Node, browsers and workers.
      // Its Node-only branch never runs here but still has to resolve.
      { find: /^node:(module|fs|path|url)$/, replacement: resolve(here, 'empty.ts') },
    ],
  },
  build: {
    target: 'es2022',
    outDir: resolve(here, 'build'),
    emptyOutDir: true,
    lib: {
      entry: resolve(here, 'host.ts'),
      formats: ['iife'],
      name: 'QmailCryptoHost',
      fileName: () => 'host.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    // Readability is worth nothing here and the file is inlined into a string.
    minify: 'esbuild',
  },
});
