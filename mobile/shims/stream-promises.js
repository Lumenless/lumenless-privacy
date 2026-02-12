// Shim for stream/promises - provides stub implementations for React Native
// These are used by arbundles but won't actually be called in mobile context

module.exports = {
  pipeline: async function pipeline(...args) {
    throw new Error('stream/promises.pipeline is not supported in React Native');
  },
  finished: async function finished(...args) {
    throw new Error('stream/promises.finished is not supported in React Native');
  },
};
