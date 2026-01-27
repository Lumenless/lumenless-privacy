// Polyfills for @solana/web3.js in React Native
// Must be imported before any @solana/web3.js usage

import { Buffer } from 'buffer';
global.Buffer = Buffer;
