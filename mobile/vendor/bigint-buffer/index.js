'use strict';
const { Buffer } = require('buffer');
// No native bindings: network-supplied buffers never enter the vulnerable C addon.
function toBigIntBE(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected Buffer');
  const hex = buffer.toString('hex');
  return hex ? BigInt('0x' + hex) : BigInt(0);
}
function toBigIntLE(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected Buffer');
  return toBigIntBE(Buffer.from(buffer).reverse());
}
function toBufferBE(number, width) {
  if (typeof number !== 'bigint' || number < BigInt(0)) throw new RangeError('Expected unsigned bigint');
  if (!Number.isSafeInteger(width) || width < 0 || width > 1048576) throw new RangeError('Invalid buffer width');
  if (width === 0 && number === BigInt(0)) return Buffer.alloc(0);
  const hex = number.toString(16);
  if (hex.length > width * 2) throw new RangeError('Integer does not fit buffer width');
  return Buffer.from(hex.padStart(width * 2, '0'), 'hex');
}
function toBufferLE(number, width) { return toBufferBE(number, width).reverse(); }
module.exports = { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE };
