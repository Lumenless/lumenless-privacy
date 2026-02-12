'use client';

import { Suspense, useMemo, useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletButton } from '@/components/WalletButton';
import { motion } from 'framer-motion';
import { Connection, PublicKey } from '@solana/web3.js';

// Message used to derive the encryption key deterministically (matches SDK)
const DERIVATION_MESSAGE = 'Privacy Money account sign in';

// Token configuration
const TOKENS = {
  SOL: { symbol: 'SOL', decimals: 9, mint: null },
  USDC: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  USDT: { symbol: 'USDT', decimals: 6, mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
} as const;

type TokenType = keyof typeof TOKENS;

/** In-memory storage fallback when localStorage is unavailable */
function createMemoryStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { Object.keys(data).forEach(k => delete data[k]); },
    key: (index: number) => Object.keys(data)[index] ?? null,
    get length() { return Object.keys(data).length; },
  };
}

interface Balances {
  SOL: number;
  USDC: number;
  USDT: number;
}

/** Post message to parent (mobile WebView) */
function postToMobile(type: string, data: Record<string, unknown>) {
  const message = JSON.stringify({ type, ...data });
  // For React Native WebView
  if (typeof window !== 'undefined' && (window as unknown as { ReactNativeWebView?: { postMessage: (msg: string) => void } }).ReactNativeWebView) {
    (window as unknown as { ReactNativeWebView: { postMessage: (msg: string) => void } }).ReactNativeWebView.postMessage(message);
  }
  // Also post to parent for iframe scenarios
  if (typeof window !== 'undefined' && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
}

/** Loading fallback for Suspense boundary */
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0a0f' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-400 mx-auto mb-4"></div>
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

export default function WithdrawPage() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless Withdraw' }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider connectorConfig={config}>
        <Suspense fallback={<LoadingFallback />}>
          <WithdrawView />
        </Suspense>
      </AppProvider>
    </QueryClientProvider>
  );
}

function WithdrawView() {
  const searchParams = useSearchParams();
  const { connected } = useConnector();
  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account?.address || null, [account]);
  
  // Check if we're in mobile WebView mode
  const isMobileWebView = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView || 
           searchParams.get('mobile') === 'true';
  }, [searchParams]);
  
  // Pre-fill from URL params (for mobile deep linking)
  const initialRecipient = searchParams.get('recipient') || '';
  const initialToken = (searchParams.get('token') as TokenType) || 'SOL';
  const initialAmount = searchParams.get('amount') || '';
  
  const [balances, setBalances] = useState<Balances | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDerivedKeys, setHasDerivedKeys] = useState(false);
  
  // Withdraw state
  const [selectedToken, setSelectedToken] = useState<TokenType>(initialToken);
  const [withdrawAddress, setWithdrawAddress] = useState(initialRecipient);
  const [withdrawAmount, setWithdrawAmount] = useState(initialAmount);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ success: boolean; message: string; tx?: string } | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  // Notify mobile when connected
  useEffect(() => {
    if (connected && ownerAddress && isMobileWebView) {
      postToMobile('connected', { address: ownerAddress });
    }
  }, [connected, ownerAddress, isMobileWebView]);

  // Fetch balances for all tokens
  const fetchBalances = useCallback(async () => {
    if (!signer?.signMessage || !ownerAddress) return;
    
    try {
      setIsLoading(true);
      setError(null);
      setProgressMessage('Signing message...');
      
      // Sign message to derive encryption keys
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await signer.signMessage(messageBytes);
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      
      setProgressMessage('Loading SDK...');
      
      // Import SDK utilities
      const sdkUtils = await import('privacycash/utils');
      const { 
        EncryptionService, 
        getUtxos, 
        getBalanceFromUtxos,
        getUtxosSPL,
        getBalanceFromUtxosSPL,
      } = sdkUtils;
      
      // Import hasher module
      const hasherModule = await import('@lightprotocol/hasher.rs');
      const { WasmFactory } = hasherModule;
      
      setProgressMessage('Loading WASM...');
      
      // Load WASM
      const wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: fetch('/hasher_wasm_simd_bg.wasm'),
          sisd: fetch('/light_wasm_hasher_bg.wasm'),
        }
      });
      void wasmModule.create();
      
      // Set up encryption service
      const encryptionService = new EncryptionService();
      encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
      
      setHasDerivedKeys(true);
      setProgressMessage('Fetching balances...');
      
      // Create connection
      const connection = new Connection(endpoint, 'confirmed');
      const storage: Storage = typeof window !== 'undefined' && window.localStorage 
        ? window.localStorage 
        : createMemoryStorage();
      const publicKey = new PublicKey(ownerAddress);
      
      // Fetch all balances in parallel
      const [solUtxos, usdcUtxos, usdtUtxos] = await Promise.all([
        getUtxos({ publicKey, connection, encryptionService, storage }),
        getUtxosSPL({ publicKey, connection, encryptionService, storage, mintAddress: TOKENS.USDC.mint! }),
        getUtxosSPL({ publicKey, connection, encryptionService, storage, mintAddress: TOKENS.USDT.mint! }),
      ]);
      
      const solBalance = getBalanceFromUtxos(solUtxos);
      const usdcBalance = getBalanceFromUtxosSPL(usdcUtxos);
      const usdtBalance = getBalanceFromUtxosSPL(usdtUtxos);
      
      const newBalances: Balances = {
        SOL: solBalance.lamports,
        USDC: usdcBalance.base_units ?? usdcBalance.amount ?? 0,
        USDT: usdtBalance.base_units ?? usdtBalance.amount ?? 0,
      };
      
      setBalances(newBalances);
      setProgressMessage(null);
      
      // Notify mobile of balances
      if (isMobileWebView) {
        postToMobile('balances', { balances: newBalances });
      }
      
    } catch (err) {
      console.error('Error fetching balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
      setProgressMessage(null);
    } finally {
      setIsLoading(false);
    }
  }, [signer, ownerAddress, endpoint, isMobileWebView]);

  // Get current token balance
  const currentBalance = balances ? balances[selectedToken] : null;
  const tokenConfig = TOKENS[selectedToken];
  const formattedBalance = currentBalance !== null 
    ? (currentBalance / Math.pow(10, tokenConfig.decimals)).toFixed(tokenConfig.decimals === 9 ? 4 : 2)
    : '---';

  // Handle withdraw
  const handleWithdraw = useCallback(async () => {
    if (!signer?.signMessage || !ownerAddress || !withdrawAddress || !withdrawAmount) {
      setWithdrawResult({ success: false, message: 'Please fill in all fields' });
      return;
    }
    
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setWithdrawResult({ success: false, message: 'Invalid amount' });
      return;
    }
    
    const baseUnits = Math.floor(amount * Math.pow(10, tokenConfig.decimals));
    if (currentBalance !== null && baseUnits > currentBalance) {
      setWithdrawResult({ success: false, message: 'Insufficient balance' });
      return;
    }
    
    try {
      setIsWithdrawing(true);
      setWithdrawResult(null);
      setProgressMessage('Signing message...');
      
      // Sign message to derive encryption keys
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await signer.signMessage(messageBytes);
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      
      setProgressMessage('Loading SDK...');
      
      // Import SDK utilities
      const sdkUtils = await import('privacycash/utils');
      const { EncryptionService, withdraw, withdrawSPL } = sdkUtils;
      
      // Import hasher module
      const hasherModule = await import('@lightprotocol/hasher.rs');
      const { WasmFactory } = hasherModule;
      
      setProgressMessage('Loading WASM...');
      
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
      const storage: Storage = typeof window !== 'undefined' && window.localStorage 
        ? window.localStorage 
        : createMemoryStorage();
      
      setProgressMessage('Generating ZK proof... (10-20 seconds)');
      
      let result: { tx: string; isPartial?: boolean };
      
      if (selectedToken === 'SOL') {
        // SOL withdraw
        result = await withdraw({
          lightWasm,
          storage,
          keyBasePath: '/circuits/transaction2',
          publicKey: new PublicKey(ownerAddress),
          connection,
          recipient: new PublicKey(withdrawAddress),
          amount_in_lamports: baseUnits,
          encryptionService,
          referrer: 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb',
        });
      } else {
        // SPL withdraw (USDC or USDT)
        result = await withdrawSPL({
          lightWasm,
          storage,
          keyBasePath: '/circuits/transaction2',
          publicKey: new PublicKey(ownerAddress),
          connection,
          recipient: new PublicKey(withdrawAddress),
          base_units: baseUnits,
          encryptionService,
          mintAddress: tokenConfig.mint!,
          referrer: 'LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb',
        });
      }
      
      const successResult = { 
        success: true, 
        message: `Withdrawal successful!`,
        tx: result.tx 
      };
      
      setWithdrawResult(successResult);
      setProgressMessage(null);
      
      // Notify mobile of success
      if (isMobileWebView) {
        postToMobile('withdraw_success', { 
          tx: result.tx, 
          token: selectedToken,
          amount: withdrawAmount,
          recipient: withdrawAddress,
        });
      }
      
      // Clear form
      setWithdrawAmount('');
      
      // Refresh balances
      await fetchBalances();
      
    } catch (err) {
      console.error('Withdraw error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Withdrawal failed';
      setWithdrawResult({ 
        success: false, 
        message: errorMessage 
      });
      setProgressMessage(null);
      
      // Notify mobile of error
      if (isMobileWebView) {
        postToMobile('withdraw_error', { error: errorMessage });
      }
    } finally {
      setIsWithdrawing(false);
    }
  }, [signer, ownerAddress, withdrawAddress, withdrawAmount, currentBalance, endpoint, fetchBalances, isMobileWebView, selectedToken, tokenConfig]);

  // Handle close button (for mobile WebView)
  const handleClose = useCallback(() => {
    if (isMobileWebView) {
      postToMobile('close', {});
    }
  }, [isMobileWebView]);

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
            background: 'radial-gradient(ellipse at 50% 0%, rgba(139, 92, 246, 0.3) 0%, transparent 50%)',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/10 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image src="/logo.svg" alt="Lumenless Logo" width={32} height={32} />
            <span className="text-xl font-semibold text-white">Lumenless</span>
          </Link>
          <div className="flex items-center gap-2">
            {isMobileWebView && (
              <Button 
                onClick={handleClose}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                Close
              </Button>
            )}
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 container mx-auto px-4 py-8 max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-6"
        >
          <h1 className="text-3xl font-bold text-white mb-2">PrivacyCash Withdraw</h1>
          <p className="text-gray-400 text-sm">
            Withdraw your private balance to any Solana wallet
          </p>
        </motion.div>

        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-white flex items-center gap-2">
              <span className="text-2xl">📤</span>
              Withdraw
            </CardTitle>
            <CardDescription className="text-gray-400">
              Select token, enter recipient and amount
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!connected ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">Connect your wallet to continue</p>
                <WalletButton />
              </div>
            ) : !hasDerivedKeys ? (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-4">Sign a message to load your balances</p>
                <Button 
                  onClick={fetchBalances}
                  disabled={isLoading}
                  className="bg-violet-500 hover:bg-violet-600 text-white"
                >
                  {isLoading ? (progressMessage || 'Loading...') : 'Load Balances'}
                </Button>
              </div>
            ) : (
              <>
                {/* Token Selection */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Token</label>
                  <div className="flex gap-2">
                    {(Object.keys(TOKENS) as TokenType[]).map((token) => (
                      <Button
                        key={token}
                        onClick={() => setSelectedToken(token)}
                        variant={selectedToken === token ? 'default' : 'outline'}
                        className={selectedToken === token 
                          ? 'bg-violet-500 hover:bg-violet-600 text-white flex-1'
                          : 'border-white/20 text-white hover:bg-white/10 flex-1'
                        }
                        disabled={isWithdrawing}
                      >
                        {token}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Balance Display */}
                <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-sm text-gray-400 mb-1">Available Balance</p>
                  <p className="text-2xl font-bold text-violet-400">
                    {formattedBalance} {selectedToken}
                  </p>
                  <Button 
                    onClick={fetchBalances}
                    disabled={isLoading}
                    variant="link"
                    className="text-gray-400 hover:text-white p-0 h-auto text-xs"
                  >
                    {isLoading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>

                {/* Recipient Address */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Recipient Address</label>
                  <Input
                    placeholder="Enter Solana address..."
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    className="bg-white/5 border-white/20 text-white"
                    disabled={isWithdrawing}
                  />
                </div>
                
                {/* Amount */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Amount ({selectedToken})</label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="0.0"
                      value={withdrawAmount}
                      onChange={(e) => {
                        if (/^\d*\.?\d*$/.test(e.target.value)) {
                          setWithdrawAmount(e.target.value);
                        }
                      }}
                      className="bg-white/5 border-white/20 text-white pr-16"
                      disabled={isWithdrawing}
                    />
                    <Button
                      onClick={() => {
                        if (currentBalance !== null) {
                          const maxAmount = currentBalance / Math.pow(10, tokenConfig.decimals);
                          setWithdrawAmount(maxAmount.toString());
                        }
                      }}
                      variant="ghost"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-violet-400 hover:text-violet-300 text-xs h-6 px-2"
                      disabled={isWithdrawing}
                    >
                      MAX
                    </Button>
                  </div>
                </div>
                
                {/* Progress Message */}
                {progressMessage && (
                  <div className="p-3 bg-violet-500/20 border border-violet-500/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-violet-400"></div>
                      <p className="text-violet-400 text-sm">{progressMessage}</p>
                    </div>
                  </div>
                )}
                
                {/* Withdraw Button */}
                <Button 
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawAddress || !withdrawAmount || currentBalance === 0}
                  className="w-full bg-violet-500 hover:bg-violet-600 text-white h-12 text-lg"
                >
                  {isWithdrawing ? 'Processing...' : 'Withdraw'}
                </Button>
                
                {/* Result Message */}
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
                        className="text-violet-400 text-sm underline mt-2 block"
                      >
                        View transaction →
                      </a>
                    )}
                  </div>
                )}
              </>
            )}
            
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info for mobile users */}
        {isMobileWebView && (
          <p className="text-center text-gray-500 text-xs mt-4">
            ZK proof generation runs in your browser for speed (10-20 seconds)
          </p>
        )}
      </main>

      {/* Footer - only show on desktop */}
      {!isMobileWebView && (
        <footer className="relative z-10 border-t border-white/10 mt-auto">
          <div className="container mx-auto px-4 py-6 text-center">
            <p className="text-gray-500 text-sm">© 2025 Lumenless. Powered by PrivacyCash.</p>
          </div>
        </footer>
      )}
    </div>
  );
}
