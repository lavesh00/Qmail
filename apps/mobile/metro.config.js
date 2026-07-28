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

module.exports = config;
