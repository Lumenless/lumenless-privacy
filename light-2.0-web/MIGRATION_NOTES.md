# Migration from @solana/wallet-adapter to @solana/connector

## Summary

This migration replaces the old `@solana/wallet-adapter` packages with `@solana/connector` (ConnectorKit), which is built on the Wallet Standard protocol.

## Changes Made

### 1. Package Updates
- **Added**: `@solana/connector` 
- **Removed**: All `@solana/wallet-adapter-*` packages

### 2. Provider Setup
- **Before**: `ConnectionProvider` + `WalletProvider` + `WalletModalProvider`
- **After**: `AppProvider` from `@solana/connector/react`

### 3. Hooks Migration
- **Before**: `useWallet()`, `useConnection()`
- **After**: `useConnector()`, `useAccount()`

### 4. Connection Management
- Connections are now created manually using `new Connection()` from `@solana/web3.js`
- No longer provided via context

### 5. Transaction Signing
- **Before**: `sendTransaction(transaction, connection, options)`
- **After**: 
  1. Sign with `signTransaction({ transaction: serialized })` 
  2. Send with `connection.sendRawTransaction(signedBuffer, options)`

### 6. Wallet Button
- Created custom `WalletButton` component to replace `WalletMultiButton`
- Uses `useConnector()` and `useAccount()` hooks

## Files Modified

1. **package.json** - Updated dependencies
2. **src/app/domains/page.tsx** - Migrated to ConnectorKit
3. **src/app/demo/page.tsx** - Migrated to ConnectorKit
4. **src/components/WalletButton.tsx** - New custom wallet button
5. **src/components/WalletStatus.tsx** - Updated to use ConnectorKit hooks
6. **src/components/WalletConnection.tsx** - Updated to use new WalletButton
7. **src/components/SimpleWalletButton.tsx** - Updated to use ConnectorKit hooks
8. **src/components/ProfilePopup.tsx** - Updated to use ConnectorKit hooks
9. **src/components/DepositModal.tsx** - Updated to use ConnectorKit hooks
10. **src/components/WithdrawModal.tsx** - Updated transaction signing
11. **src/components/PrivatePaymentForm.tsx** - Updated with wallet adapter for Arcium

## Next Steps

1. **Install the package**:
   ```bash
   npm install
   ```

2. **Test the migration**:
   - Test wallet connection/disconnection
   - Test transaction signing and sending
   - Verify all wallet interactions work correctly

3. **Remove old CSS import** (if present):
   - Remove `@solana/wallet-adapter-react-ui/styles.css` imports

## Important Notes

- ConnectorKit uses Wallet Standard, so it automatically detects compatible wallets (Phantom, Solflare, Backpack, etc.)
- No need to manually register individual wallet adapters
- The `signTransaction` API returns base64-encoded signed transactions
- Connection objects must be created manually for each component that needs them

## API Differences

### Getting Public Key
```typescript
// Before
const { publicKey } = useWallet();

// After
const { account } = useConnector();
const publicKey = account ? new PublicKey(account.address) : null;
```

### Sending Transactions
```typescript
// Before
const signature = await sendTransaction(transaction, connection, options);

// After
const signedBase64 = await signTransaction({
  transaction: transaction.serialize({ requireAllSignatures: false }),
});
const signature = await connection.sendRawTransaction(
  Buffer.from(signedBase64, 'base64'),
  options
);
```

### Wallet Connection
```typescript
// Before
const { connect, disconnect } = useWallet();
await connect();

// After
const { select, disconnect, wallets } = useConnector();
await select(wallets[0].wallet.name);
```

