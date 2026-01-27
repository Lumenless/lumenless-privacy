// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add polyfills for @solana/web3.js and @metaplex-foundation/js
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('readable-stream'),
  zlib: require.resolve('browserify-zlib'),
  path: require.resolve('path-browserify'),
  url: require.resolve('react-native-url-polyfill'),
};

module.exports = config;
