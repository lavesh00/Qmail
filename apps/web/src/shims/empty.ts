/**
 * Stands in for Node built-ins that the liboqs WASM glue references but never
 * reaches in a browser.
 *
 * See the alias in vite.config.ts. Nothing here is ever called; it exists so
 * the bundler can finish resolving a branch that is dead on this platform.
 */
export default {};
