const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const test = require('node:test');
test('Jupiter exposes its current public key to checkout after connection and clears it on disconnect', async () => {
  let adapter;
  const key = { toBase58: () => 'jupiter-account' };
  class Adapter {
    constructor() { adapter = this; }
    async connect() { this.publicKey = key; }
    async signMessage(message) { return message; }
    async signTransaction(transaction) { return transaction; }
  }
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/tweet-orders/wallet.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    if (name === '@wallet-standard/app') return { getWallets: () => ({ get: () => [{ name: 'Jupiter' }] }) };
    if (name === '@solana/wallet-standard-wallet-adapter') return { StandardWalletAdapter: Adapter };
    if (name === '@solana/wallet-adapter-base') return { isWalletAdapterCompatibleStandardWallet: () => true };
    return require(name);
  } });
  const provider = module.exports.walletProvider('Jupiter');
  assert.equal(provider.publicKey, undefined);
  const account = await provider.connect();
  assert.equal(provider.publicKey, account.publicKey);
  assert.equal(provider.publicKey.toBase58(), 'jupiter-account');
  const message = new Uint8Array([1, 2]);
  assert.equal(await provider.signMessage(message), message);
  const transaction = { version: 0 };
  assert.equal(await provider.signTransaction(transaction), transaction);
  adapter.publicKey = null;
  assert.equal(provider.publicKey, undefined);
});
