// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Empty shim for Node modules that can't run in React Native
const emptyShim = require.resolve('./shims/empty.js');
const streamPromisesShim = require.resolve('./shims/stream-promises.js');

// Add polyfills for @solana/web3.js and @metaplex-foundation/js
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('readable-stream'),
  zlib: require.resolve('browserify-zlib'),
  path: require.resolve('path-browserify'),
  url: require.resolve('react-native-url-polyfill'),
  // Shim Node modules used by @irys/sdk (pulled in by @metaplex-foundation/js)
  fs: emptyShim,
  net: emptyShim,
  tls: emptyShim,
  child_process: emptyShim,
  os: emptyShim,
  http: emptyShim,
  https: emptyShim,
  dns: emptyShim,
};

// Node modules that need to be shimmed to empty (used by @irys/sdk and dependencies)
const nodeModulesToShim = [
  'stream/promises',
  'readline',
  'worker_threads',
  'perf_hooks',
  'inspector',
  'async_hooks',
  'v8',
  'vm',
  'cluster',
  'dgram',
  'module',
  'assert',
  'constants',
  'domain',
  'events',
  'os',
  'process',
  'punycode',
  'querystring',
  'string_decoder',
  'sys',
  'timers',
  'tty',
  'util',
];

// Map of node: protocol modules to their polyfills (or empty shim)
const nodeProtocolPolyfills = {
  'node:path': require.resolve('path-browserify'),
  'node:crypto': require.resolve('crypto-browserify'),
  'node:stream': require.resolve('readable-stream'),
  'node:url': require.resolve('react-native-url-polyfill'),
  'node:buffer': require.resolve('buffer/'),
  'node:os': emptyShim,
  'node:fs': emptyShim,
  'node:net': emptyShim,
  'node:tls': emptyShim,
  'node:http': emptyShim,
  'node:https': emptyShim,
  'node:child_process': emptyShim,
  'node:dns': emptyShim,
  'node:readline': emptyShim,
  'node:util': emptyShim,
  'node:events': emptyShim,
  'node:assert': emptyShim,
  'node:zlib': require.resolve('browserify-zlib'),
};

// Custom resolver for subpath imports and Node builtins that can't be handled by extraNodeModules
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Handle stream/promises which needs a specific shim
  if (moduleName === 'stream/promises') {
    return {
      filePath: streamPromisesShim,
      type: 'sourceFile',
    };
  }
  // Handle node: protocol imports
  if (moduleName.startsWith('node:')) {
    const polyfill = nodeProtocolPolyfills[moduleName];
    if (polyfill) {
      return {
        filePath: polyfill,
        type: 'sourceFile',
      };
    }
    // Default to empty shim for unknown node: modules
    return {
      filePath: emptyShim,
      type: 'sourceFile',
    };
  }
  // Handle other Node.js builtins that need empty shims
  if (nodeModulesToShim.includes(moduleName)) {
    return {
      filePath: emptyShim,
      type: 'sourceFile',
    };
  }
  // Fall back to default resolver
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
