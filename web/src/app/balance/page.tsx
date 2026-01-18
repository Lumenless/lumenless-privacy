'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletButton } from '@/components/WalletButton';
import { motion } from 'framer-motion';
import { Connection, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';

// Message used to derive the encryption key deterministically (matches SDK)
const DERIVATION_MESSAGE = 'Privacy Money account sign in';

interface UtxoDisplay {
  amount: number;
  index: number;
  commitment: string;
}

export default function BalancePage() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless Balance' }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider connectorConfig={config}>
        <BalanceView />
      </AppProvider>
    </QueryClientProvider>
  );
}

function BalanceView() {
  const { connected } = useConnector();
  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account?.address || null, [account]);
  
  const [balance, setBalance] = useState<number | null>(null);
  const [utxos, setUtxos] = useState<UtxoDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDerivedKeys, setHasDerivedKeys] = useState(false);
  
  // Withdraw state
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ success: boolean; message: string; tx?: string } | null>(null);
  
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  // Fetch balance when keys are derived
  const fetchBalance = useCallback(async () => {
    if (!signer || !ownerAddress) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Sign message to derive encryption keys
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await signer.signMessage(messageBytes);
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      
      // Import SDK utilities
      const sdkUtils = await import('@lumenless/privacycash/utils');
      const { EncryptionService, getUtxos, getBalanceFromUtxos } = sdkUtils;
      
      // Import hasher module
      const hasherModule = await import('@lightprotocol/hasher.rs');
      const { WasmFactory } = hasherModule;
      
      // Load WASM
      const wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: fetch('/hasher_wasm_simd_bg.wasm'),
          sisd: fetch('/light_wasm_hasher_bg.wasm'),
        }
      });
      const lightWasm = wasmModule.create();
      
      // Set up encryption service
      const encryptionService = new EncryptionService();
      encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
      
      setHasDerivedKeys(true);
      
      // Create connection
      const connection = new Connection(endpoint, 'confirmed');
      
      // Fetch UTXOs
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      const fetchedUtxos = await getUtxos({
        publicKey: new PublicKey(ownerAddress),
        connection,
        encryptionService,
        storage,
      });
      
      // Calculate balance
      const balanceResult = getBalanceFromUtxos(fetchedUtxos);
      setBalance(balanceResult.lamports);
      
      // Store UTXO display info
      const utxoDisplays: UtxoDisplay[] = [];
      for (const utxo of fetchedUtxos) {
        const commitment = await utxo.getCommitment();
        utxoDisplays.push({
          amount: utxo.amount.toNumber(),
          index: utxo.index,
          commitment: commitment.slice(0, 16) + '...',
        });
      }
      setUtxos(utxoDisplays);
      
    } catch (err) {
      console.error('Error fetching balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
    } finally {
      setIsLoading(false);
    }
  }, [signer, ownerAddress, endpoint]);

  // Handle withdraw
  const handleWithdraw = useCallback(async () => {
    if (!signer || !ownerAddress || !withdrawAddress || !withdrawAmount) {
      setWithdrawResult({ success: false, message: 'Please fill in all fields' });
      return;
    }
    
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setWithdrawResult({ success: false, message: 'Invalid amount' });
      return;
    }
    
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
    if (balance !== null && lamports > balance) {
      setWithdrawResult({ success: false, message: 'Insufficient balance' });
      return;
    }
    
    try {
      setIsWithdrawing(true);
      setWithdrawResult(null);
      
      // Sign message to derive encryption keys
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await signer.signMessage(messageBytes);
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      
      // Import SDK utilities
      const sdkUtils = await import('@lumenless/privacycash/utils');
      const { EncryptionService, withdraw } = sdkUtils;
      
      // Import hasher module
      const hasherModule = await import('@lightprotocol/hasher.rs');
      const { WasmFactory } = hasherModule;
      
      // Load WASM
      const wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: fetch('/hasher_wasm_simd_bg.wasm'),
          sisd: fetch('/light_wasm_hasher_bg.wasm'),
        }
      });
      const lightWasm = wasmModule.create();
      
      // Set up encryption service
      const encryptionService = new EncryptionService();
      encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
      
      // Create connection
      const connection = new Connection(endpoint, 'confirmed');
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      
      // Perform withdraw
      const result = await withdraw({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2',
        publicKey: new PublicKey(ownerAddress),
        connection,
        recipient: new PublicKey(withdrawAddress),
        amount_in_lamports: lamports,
        encryptionService,
        transactionSigner: async (tx: VersionedTransaction) => {
          const serialized = tx.serialize();
          const signed = await signer.signTransaction(serialized);
          if (signed instanceof VersionedTransaction) {
            return signed;
          }
          if (signed instanceof Uint8Array) {
            return VersionedTransaction.deserialize(signed);
          }
          if (signed && typeof signed === 'object' && 'serialize' in signed) {
            const serializedSigned = (signed as { serialize(): Uint8Array }).serialize();
            return VersionedTransaction.deserialize(serializedSigned);
          }
          throw new Error('Unexpected signed transaction type');
        },
      });
      
      setWithdrawResult({ 
        success: true, 
        message: `Withdrawal successful!`,
        tx: result.tx 
      });
      
      // Refresh balance
      await fetchBalance();
      
    } catch (err) {
      console.error('Withdraw error:', err);
      setWithdrawResult({ 
        success: false, 
        message: err instanceof Error ? err.message : 'Withdrawal failed' 
      });
    } finally {
      setIsWithdrawing(false);
    }
  }, [signer, ownerAddress, withdrawAddress, withdrawAmount, balance, endpoint, fetchBalance]);

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: '#0a0a0f' }}>
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(20, 184, 166, 0.3) 0%, transparent 50%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image src="/logo.svg" alt="Lumenless Logo" width={32} height={32} />
            <span className="text-xl font-semibold text-white">Lumenless</span>
          </a>
          <WalletButton />
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 container mx-auto px-4 py-12 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold text-white mb-4">PrivacyCash Balance</h1>
          <p className="text-gray-400">
            View and withdraw your private balance (including pay link deposits).
          </p>
        </motion.div>

        <div className="space-y-6">
          {/* Balance Card */}
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <span className="text-2xl">💰</span>
                Your Balance
              </CardTitle>
              <CardDescription className="text-gray-400">
                Private SOL balance from deposits and pay links
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!connected ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">Connect your wallet to view balance</p>
                  <WalletButton />
                </div>
              ) : !hasDerivedKeys ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">Sign a message to derive your encryption keys</p>
                  <Button 
                    onClick={fetchBalance}
                    disabled={isLoading}
                    className="bg-teal-500 hover:bg-teal-600 text-white"
                  >
                    {isLoading ? 'Loading...' : 'Load Balance'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <p className="text-5xl font-bold text-teal-400">
                      {balance !== null ? (balance / LAMPORTS_PER_SOL).toFixed(4) : '---'} SOL
                    </p>
                    <p className="text-gray-500 mt-2">
                      {balance !== null ? `${balance.toLocaleString()} lamports` : ''}
                    </p>
                  </div>
                  
                  {utxos.length > 0 && (
                    <div className="border-t border-white/10 pt-4">
                      <p className="text-sm text-gray-400 mb-2">UTXOs ({utxos.length}):</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {utxos.map((utxo, i) => (
                          <div key={i} className="flex justify-between text-sm bg-white/5 p-2 rounded">
                            <span className="text-gray-400">#{utxo.index}</span>
                            <span className="text-teal-400">{(utxo.amount / LAMPORTS_PER_SOL).toFixed(4)} SOL</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <Button 
                    onClick={fetchBalance}
                    disabled={isLoading}
                    variant="outline"
                    className="w-full border-white/20 text-white hover:bg-white/10"
                  >
                    {isLoading ? 'Refreshing...' : 'Refresh Balance'}
                  </Button>
                </div>
              )}
              
              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Withdraw Card */}
          {hasDerivedKeys && balance !== null && balance > 0 && (
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <span className="text-2xl">📤</span>
                  Withdraw
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Withdraw SOL to any wallet address privately
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Recipient Address</label>
                  <Input
                    placeholder="Enter Solana address..."
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    className="bg-white/5 border-white/20 text-white"
                  />
                </div>
                
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Amount (SOL)</label>
                  <Input
                    type="text"
                    placeholder="0.0"
                    value={withdrawAmount}
                    onChange={(e) => {
                      if (/^\d*\.?\d*$/.test(e.target.value)) {
                        setWithdrawAmount(e.target.value);
                      }
                    }}
                    className="bg-white/5 border-white/20 text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Available: {(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </p>
                </div>
                
                <Button 
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawAddress || !withdrawAmount}
                  className="w-full bg-teal-500 hover:bg-teal-600 text-white"
                >
                  {isWithdrawing ? 'Processing...' : 'Withdraw'}
                </Button>
                
                {withdrawResult && (
                  <div className={`p-3 rounded-lg ${
                    withdrawResult.success 
                      ? 'bg-green-500/20 border border-green-500/30' 
                      : 'bg-red-500/20 border border-red-500/30'
                  }`}>
                    <p className={withdrawResult.success ? 'text-green-400' : 'text-red-400'}>
                      {withdrawResult.message}
                    </p>
                    {withdrawResult.tx && (
                      <a 
                        href={`https://explorer.solana.com/tx/${withdrawResult.tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-400 text-sm underline mt-2 block"
                      >
                        View transaction →
                      </a>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 mt-auto">
        <div className="container mx-auto px-4 py-6 text-center">
          <p className="text-gray-500 text-sm">© 2025 Lumenless. Powered by PrivacyCash.</p>
        </div>
      </footer>
    </div>
  );
}
