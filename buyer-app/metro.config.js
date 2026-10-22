const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Monorepo-aware Metro config.
// - watch the repo root so the shared `common/` sources are bundled & transpiled
// - resolve modules from both the app and the hoisted root node_modules
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
