// Polyfills for @solana/kit in React Native
// Must be imported before any @solana/kit usage

console.log('[Polyfills] Starting...');

// 1. Polyfill crypto.getRandomValues and crypto.subtle.digest using expo-crypto
import * as ExpoCrypto from 'expo-crypto';

class Crypto {
  getRandomValues = ExpoCrypto.getRandomValues;
  subtle = {
    // Polyfill digest using expo-crypto
    digest: async (algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
      const algoMap: Record<string, ExpoCrypto.CryptoDigestAlgorithm> = {
        'SHA-256': ExpoCrypto.CryptoDigestAlgorithm.SHA256,
        'SHA-384': ExpoCrypto.CryptoDigestAlgorithm.SHA384,
        'SHA-512': ExpoCrypto.CryptoDigestAlgorithm.SHA512,
      };
      
      const algo = algoMap[algorithm];
      if (!algo) {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
      }
      
      // Convert BufferSource to Uint8Array
      let bytes: Uint8Array;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        bytes = new Uint8Array(data as any);
      }
      
      const hashHex = await ExpoCrypto.digestStringAsync(
        algo,
        Array.from(bytes).map(b => String.fromCharCode(b)).join(''),
        { encoding: ExpoCrypto.CryptoEncoding.HEX }
      );
      
      // Convert hex string back to ArrayBuffer
      const hashBytes = new Uint8Array(hashHex.length / 2);
      for (let i = 0; i < hashHex.length; i += 2) {
        hashBytes[i / 2] = parseInt(hashHex.substr(i, 2), 16);
      }
      
      return hashBytes.buffer;
    },
  } as SubtleCrypto;
}

if (typeof globalThis.crypto === 'undefined') {
  console.log('[Polyfills] Setting up crypto...');
  (globalThis as any).crypto = new Crypto();
} else if (typeof globalThis.crypto.subtle?.digest !== 'function') {
  console.log('[Polyfills] Adding subtle.digest to existing crypto...');
  const existingCrypto = globalThis.crypto;
  (globalThis as any).crypto = {
    ...existingCrypto,
    getRandomValues: existingCrypto.getRandomValues || ExpoCrypto.getRandomValues,
    subtle: {
      ...existingCrypto.subtle,
      digest: new Crypto().subtle.digest,
    },
  };
}

console.log('[Polyfills] crypto ready');

// 2. Ed25519 polyfill - wrap in try/catch to see errors
try {
  console.log('[Polyfills] Installing Ed25519 polyfill...');
  const { install } = require('@solana/webcrypto-ed25519-polyfill');
  install();
  console.log('[Polyfills] Ed25519 polyfill installed');
} catch (error) {
  console.error('[Polyfills] Ed25519 polyfill failed:', error);
}

console.log('[Polyfills] Complete');
