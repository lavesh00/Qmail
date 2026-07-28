// Metro configuration for a package inside an npm-workspaces monorepo.
// Without the watchFolders/nodeModulesPaths entries, Metro will not follow
// `@qmail/crypto` up to the repo root where npm hoists it.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Resolve a single copy of React so the workspace package and the app agree.
config.resolver.disableHierarchicalLookup = true;

/**
 * The liboqs WASM glue is one build shared across Node, browsers and workers.
 * Its Node-only branch is dead code under Hermes — guarded by a
 * `process.versions.node` check that is false here — but Metro still has to
 * resolve the specifiers before it can decide that. Point them at an empty
 * module rather than letting the bundle fail on built-ins that will never load.
 */
const NODE_BUILTIN_STUBS = new Set(['node:module', 'node:fs', 'node:path', 'node:url']);
const emptyShim = path.resolve(projectRoot, 'shims/empty.js');

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_BUILTIN_STUBS.has(moduleName)) {
    return { type: 'sourceFile', filePath: emptyShim };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
