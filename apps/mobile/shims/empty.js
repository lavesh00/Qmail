/**
 * Stands in for Node built-ins that the liboqs WASM glue references but never
 * reaches on this platform.
 *
 * The glue is compiled for Node, browsers and workers from one source. Its
 * Node-only branch is guarded by a `process.versions.node` check that is false
 * under Hermes, so nothing here is ever called — but Metro still has to resolve
 * the specifiers to finish bundling.
 */
module.exports = {};
