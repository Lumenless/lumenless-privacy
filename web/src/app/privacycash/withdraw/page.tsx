'use client';

import { Suspense, useMemo, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletButton } from '@/components/WalletButton';
import { Connection, PublicKey } from '@solana/web3.js';

// Message used to derive the encryption key deterministically (matches SDK)
const DERIVATION_MESSAGE = 'Privacy Money account sign in';

// Token configuration
const TOKENS = {
  SOL: { symbol: 'SOL', label: '◎ SOL', decimals: 9, mint: null },
  USDC: { symbol: 'USDC', label: '$ USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  USDT: { symbol: 'USDT', label: '$ USDT', decimals: 6, mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
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

// Pending signature requests from mobile
const pendingSignatureRequests = new Map<string, { resolve: (sig: Uint8Array) => void; reject: (err: Error) => void }>();

/** Request signature from mobile app via postMessage */
function requestMobileSignature(message: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(7);
    
    // Check if we're actually in a WebView
    const hasReactNativeWebView = typeof window !== 'undefined' && 
      !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    
    console.log('[Withdraw] Requesting mobile signature, requestId:', requestId, 'hasWebView:', hasReactNativeWebView);
    
    if (!hasReactNativeWebView) {
      reject(new Error('Not running in mobile WebView. Please use the mobile app.'));
      return;
    }
    
    // Store the promise handlers
    pendingSignatureRequests.set(requestId, { resolve, reject });
    
    // Encode message as base64
    const messageBase64 = btoa(String.fromCharCode(...message));
    
    // Request signature from native app
    postToMobile('sign_message', { message: messageBase64, requestId });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingSignatureRequests.has(requestId)) {
        pendingSignatureRequests.delete(requestId);
        console.error('[Withdraw] Signature request timed out, requestId:', requestId);
        reject(new Error('Signature request timed out. Please try again.'));
      }
    }, 60000);
  });
}

/** Handle signature response from mobile app */
function handleMobileSignatureResponse(data: { requestId: string; signature?: string; error?: string }) {
  const pending = pendingSignatureRequests.get(data.requestId);
  if (!pending) return;
  
  pendingSignatureRequests.delete(data.requestId);
  
  if (data.error) {
    pending.reject(new Error(data.error));
  } else if (data.signature) {
    // Decode base64 signature
    const signatureBytes = Uint8Array.from(atob(data.signature), c => c.charCodeAt(0));
    pending.resolve(signatureBytes);
  } else {
    pending.reject(new Error('Invalid signature response'));
  }
}

/** Loading fallback for Suspense boundary */
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#08080c' }}>
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p style={{ color: '#71717a' }}>Loading...</p>
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
  const { connected: browserConnected } = useConnector();
  const { account } = useAccount();
  const { signer: browserSigner } = useTransactionSigner();
  
  // Check if we're in mobile WebView mode
  const isMobileWebView = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView || 
           searchParams.get('mobile') === 'true';
  }, [searchParams]);
  
  // Get wallet address from URL params (for mobile) or from browser wallet
  const mobileWalletAddress = searchParams.get('walletAddress');
  const ownerAddress = useMemo(() => {
    if (isMobileWebView && mobileWalletAddress) {
      return mobileWalletAddress;
    }
    return account?.address || null;
  }, [isMobileWebView, mobileWalletAddress, account]);
  
  // Consider connected if we have a mobile wallet address OR browser is connected
  const connected = useMemo(() => {
    if (isMobileWebView && mobileWalletAddress) {
      return true;
    }
    return browserConnected;
  }, [isMobileWebView, mobileWalletAddress, browserConnected]);
  
  // Pre-fill from URL params (for mobile deep linking)
  const initialRecipient = searchParams.get('recipient') || '';
  const initialToken = (searchParams.get('token') as TokenType) || 'SOL';
  const initialAmount = searchParams.get('amount') || '';
  
  // Parse pre-loaded balances from URL (passed from mobile app)
  const preloadedBalances = useMemo((): Balances | null => {
    const balancesParam = searchParams.get('balances');
    if (!balancesParam) return null;
    try {
      const parsed = JSON.parse(balancesParam);
      // Validate it has the expected structure
      if (typeof parsed.SOL === 'number' && typeof parsed.USDC === 'number' && typeof parsed.USDT === 'number') {
        return parsed as Balances;
      }
    } catch {
      console.error('[Withdraw] Failed to parse balances from URL');
    }
    return null;
  }, [searchParams]);
  
  // Listen for signature responses from mobile
  useEffect(() => {
    if (!isMobileWebView) return;
    
    console.log('[Withdraw] Setting up message listener for mobile');
    
    const handleMessage = (event: MessageEvent) => {
      console.log('[Withdraw] Received message event:', typeof event.data, event.data?.toString?.()?.slice(0, 100));
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        console.log('[Withdraw] Parsed message type:', data?.type);
        if (data.type === 'sign_message_response' || data.type === 'sign_message_error') {
          console.log('[Withdraw] Handling signature response');
          handleMobileSignatureResponse(data);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isMobileWebView]);
  
  // Initialize balances from preloaded data or null
  const [balances, setBalances] = useState<Balances | null>(preloadedBalances);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // If we have preloaded balances, we can skip the "Load Balances" step
  const [hasDerivedKeys, setHasDerivedKeys] = useState(!!preloadedBalances);
  
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
    if (!ownerAddress) return;
    // For browser, need signer. For mobile, we'll use postMessage
    if (!isMobileWebView && !browserSigner?.signMessage) return;
    
    try {
      setIsLoading(true);
      setError(null);
      setProgressMessage('Signing message...');
      
      // Sign message to derive encryption keys
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      let sigBytes: Uint8Array;
      
      if (isMobileWebView) {
        // Request signature from mobile app
        sigBytes = await requestMobileSignature(messageBytes);
      } else if (browserSigner?.signMessage) {
        // Use browser wallet
        const signature = await browserSigner.signMessage(messageBytes);
        sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      } else {
        throw new Error('No signer available');
      }
      
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
  }, [browserSigner, ownerAddress, endpoint, isMobileWebView]);

  // Get current token balance
  const currentBalance = balances ? balances[selectedToken] : null;
  const tokenConfig = TOKENS[selectedToken];
  const formattedBalance = currentBalance !== null 
    ? (currentBalance / Math.pow(10, tokenConfig.decimals)).toFixed(tokenConfig.decimals === 9 ? 4 : 2)
    : '---';

  // Fee config state
  const [feeConfig, setFeeConfig] = useState<{
    withdraw_fee_rate: number;
    withdraw_rent_fee: number;
    rent_fees: Record<string, number>;
  } | null>(null);

  // Fetch fee config on mount
  useEffect(() => {
    const fetchFeeConfig = async () => {
      try {
        const res = await fetch('https://api3.privacycash.org/config');
        const config = await res.json();
        setFeeConfig(config);
      } catch (err) {
        console.error('Failed to fetch fee config:', err);
      }
    };
    fetchFeeConfig();
  }, []);

  // Calculate receiver amount after fees
  const receiverAmount = useMemo(() => {
    if (!feeConfig || !withdrawAmount) return null;
    
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return null;
    
    const baseUnits = Math.floor(amount * Math.pow(10, tokenConfig.decimals));
    
    let feeBaseUnits: number;
    if (selectedToken === 'SOL') {
      // SOL fee: amount * fee_rate + 1 SOL * rent_fee
      feeBaseUnits = Math.floor(
        baseUnits * feeConfig.withdraw_fee_rate + 
        1e9 * feeConfig.withdraw_rent_fee
      );
    } else {
      // SPL token fee: amount * fee_rate + units_per_token * token_rent_fee
      const tokenName = selectedToken.toLowerCase();
      const tokenRentFee = feeConfig.rent_fees?.[tokenName] || 0;
      feeBaseUnits = Math.floor(
        baseUnits * feeConfig.withdraw_fee_rate + 
        Math.pow(10, tokenConfig.decimals) * tokenRentFee
      );
    }
    
    const receiverBaseUnits = baseUnits - feeBaseUnits;
    if (receiverBaseUnits <= 0) return 0;
    
    return receiverBaseUnits / Math.pow(10, tokenConfig.decimals);
  }, [feeConfig, withdrawAmount, selectedToken, tokenConfig.decimals]);

  // Handle withdraw
  const handleWithdraw = useCallback(async () => {
    if (!ownerAddress || !withdrawAddress || !withdrawAmount) {
      setWithdrawResult({ success: false, message: 'Please fill in all fields' });
      return;
    }
    // For browser, need signer. For mobile, we'll use postMessage
    if (!isMobileWebView && !browserSigner?.signMessage) {
      setWithdrawResult({ success: false, message: 'Wallet not connected' });
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
      let sigBytes: Uint8Array;
      
      if (isMobileWebView) {
        // Request signature from mobile app
        sigBytes = await requestMobileSignature(messageBytes);
      } else if (browserSigner?.signMessage) {
        // Use browser wallet
        const signature = await browserSigner.signMessage(messageBytes);
        sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      } else {
        throw new Error('No signer available');
      }
      
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
      
      // Refresh balances (skip in mobile mode - balance will refresh when user returns to main screen)
      if (!isMobileWebView) {
        await fetchBalances();
      }
      
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
  }, [browserSigner, ownerAddress, withdrawAddress, withdrawAmount, currentBalance, endpoint, fetchBalances, isMobileWebView, selectedToken, tokenConfig]);

  // Handle close button (for mobile WebView)
  const handleClose = useCallback(() => {
    if (isMobileWebView) {
      postToMobile('close', {});
    }
  }, [isMobileWebView]);

  // CSS-in-JS styles matching mobile theme
  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #1a1025 0%, #08080c 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    },
    modal: {
      backgroundColor: '#141418',
      borderRadius: '20px',
      padding: '24px',
      width: '100%',
      maxWidth: '400px',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    },
    title: {
      fontSize: '20px',
      fontWeight: '700',
      color: '#fafafa',
      marginBottom: '8px',
    },
    tokenRow: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
    },
    tokenBtn: {
      padding: '8px 12px',
      borderRadius: '10px',
      backgroundColor: '#141418',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      cursor: 'pointer',
      transition: 'all 0.2s',
      fontSize: '13px',
      fontWeight: '500',
      color: '#a1a1aa',
    },
    tokenBtnActive: {
      backgroundColor: 'rgba(139, 92, 246, 0.15)',
      borderColor: '#8b5cf6',
      color: '#8b5cf6',
      fontWeight: '600',
    },
    desc: {
      fontSize: '13px',
      fontWeight: '500',
      color: '#71717a',
      marginBottom: '16px',
    },
    input: {
      width: '100%',
      backgroundColor: '#08080c',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: '14px',
      padding: '12px 16px',
      fontSize: '15px',
      fontWeight: '500',
      color: '#fafafa',
      marginBottom: '12px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    },
    inputError: {
      borderColor: '#ef4444',
    },
    buttons: {
      display: 'flex',
      gap: '8px',
      marginTop: '16px',
    },
    btn: {
      flex: 1,
      padding: '12px',
      borderRadius: '14px',
      fontSize: '15px',
      fontWeight: '600',
      cursor: 'pointer',
      border: 'none',
      minHeight: '48px',
      transition: 'opacity 0.2s',
    },
    btnPrimary: {
      backgroundColor: '#8b5cf6',
      color: '#fafafa',
    },
    btnSecondary: {
      backgroundColor: '#141418',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      color: '#71717a',
    },
    btnDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      padding: '32px 0',
      gap: '12px',
    },
    loadingText: {
      fontSize: '15px',
      fontWeight: '500',
      color: '#fafafa',
    },
    loadingSubtext: {
      fontSize: '13px',
      fontWeight: '500',
      color: '#71717a',
      textAlign: 'center' as const,
    },
    errorText: {
      color: '#ef4444',
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '12px',
    },
    successText: {
      color: '#22c55e',
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '8px',
    },
    balanceDisplay: {
      backgroundColor: '#08080c',
      borderRadius: '14px',
      padding: '16px',
      marginBottom: '16px',
      border: '1px solid rgba(255, 255, 255, 0.06)',
    },
    balanceLabel: {
      fontSize: '13px',
      fontWeight: '500',
      color: '#71717a',
      marginBottom: '4px',
    },
    balanceValue: {
      fontSize: '24px',
      fontWeight: '700',
      color: '#8b5cf6',
    },
    refreshBtn: {
      fontSize: '12px',
      color: '#71717a',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
      marginTop: '4px',
    },
    link: {
      color: '#8b5cf6',
      fontSize: '13px',
      textDecoration: 'underline',
      marginTop: '8px',
      display: 'block',
    },
    maxBtn: {
      position: 'absolute' as const,
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      color: '#8b5cf6',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      padding: '4px 8px',
    },
    inputWrapper: {
      position: 'relative' as const,
      marginBottom: '12px',
    },
    walletSection: {
      textAlign: 'center' as const,
      padding: '32px 0',
    },
    walletText: {
      color: '#71717a',
      fontSize: '15px',
      marginBottom: '16px',
    },
    progressBox: {
      backgroundColor: 'rgba(139, 92, 246, 0.15)',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: '14px',
      padding: '12px',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    spinner: {
      width: '16px',
      height: '16px',
      border: '2px solid #8b5cf6',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    },
    progressText: {
      color: '#8b5cf6',
      fontSize: '13px',
      fontWeight: '500',
    },
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        input::placeholder {
          color: #71717a;
        }
        button:hover:not(:disabled) {
          opacity: 0.8;
        }
        input:focus {
          border-color: rgba(139, 92, 246, 0.5);
        }
      `}</style>
      
      <div style={styles.container}>
        <div style={styles.modal}>
          {/* Title with close button for mobile */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h1 style={styles.title}>Withdraw</h1>
            {isMobileWebView && (
              <button
                onClick={handleClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#71717a',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>

          {!connected ? (
            <div style={styles.walletSection}>
              <p style={styles.walletText}>Connect your wallet to continue</p>
              <WalletButton />
            </div>
          ) : !hasDerivedKeys ? (
            <div style={styles.walletSection}>
              <p style={styles.walletText}>Sign a message to load your balances</p>
              <button
                onClick={fetchBalances}
                disabled={isLoading}
                style={{
                  ...styles.btn,
                  ...styles.btnPrimary,
                  ...(isLoading ? styles.btnDisabled : {}),
                  flex: 'none',
                  padding: '12px 24px',
                }}
              >
                {isLoading ? (progressMessage || 'Loading...') : 'Load Balances'}
              </button>
            </div>
          ) : (
            <>
              {/* Token Selection */}
              <div style={styles.tokenRow}>
                {(Object.keys(TOKENS) as TokenType[]).map((token) => (
                  <button
                    key={token}
                    onClick={() => setSelectedToken(token)}
                    disabled={isWithdrawing}
                    style={{
                      ...styles.tokenBtn,
                      ...(selectedToken === token ? styles.tokenBtnActive : {}),
                      ...(isWithdrawing ? styles.btnDisabled : {}),
                    }}
                  >
                    {TOKENS[token].label}
                  </button>
                ))}
              </div>

              {/* Balance Display */}
              <div style={styles.balanceDisplay}>
                <p style={styles.balanceLabel}>Available Balance</p>
                <p style={styles.balanceValue}>
                  {formattedBalance} {selectedToken}
                </p>
                {/* Only show refresh for browser mode - mobile has preloaded balances */}
                {!preloadedBalances && (
                  <button
                    onClick={fetchBalances}
                    disabled={isLoading}
                    style={{ ...styles.refreshBtn, ...(isLoading ? styles.btnDisabled : {}) }}
                  >
                    {isLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                )}
              </div>

              <p style={styles.desc}>Send to a Solana wallet address</p>

              {/* Recipient Address */}
              <input
                type="text"
                placeholder="Destination wallet address"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                disabled={isWithdrawing}
                style={{
                  ...styles.input,
                  ...(isWithdrawing ? styles.btnDisabled : {}),
                }}
              />

              {/* Amount with MAX button */}
              <div style={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder={`Amount ${TOKENS[selectedToken].label}`}
                  value={withdrawAmount}
                  onChange={(e) => {
                    if (/^\d*\.?\d*$/.test(e.target.value)) {
                      setWithdrawAmount(e.target.value);
                    }
                  }}
                  disabled={isWithdrawing}
                  style={{
                    ...styles.input,
                    marginBottom: 0,
                    paddingRight: '60px',
                    ...(isWithdrawing ? styles.btnDisabled : {}),
                  }}
                />
                <button
                  onClick={() => {
                    if (currentBalance !== null) {
                      const maxAmount = currentBalance / Math.pow(10, tokenConfig.decimals);
                      setWithdrawAmount(maxAmount.toString());
                    }
                  }}
                  disabled={isWithdrawing}
                  style={{ ...styles.maxBtn, ...(isWithdrawing ? styles.btnDisabled : {}) }}
                >
                  MAX
                </button>
              </div>

              {/* Receiver Amount (after fees) */}
              {withdrawAmount && receiverAmount !== null && (
                <p style={{
                  fontSize: '13px',
                  color: receiverAmount > 0 ? '#a1a1aa' : '#ef4444',
                  marginBottom: '12px',
                  marginTop: '-4px',
                }}>
                  {receiverAmount > 0 
                    ? `After fees, receiver will get ${receiverAmount.toFixed(tokenConfig.decimals === 9 ? 4 : 2)} ${selectedToken}`
                    : 'Amount too low to cover fees'
                  }
                </p>
              )}

              {/* Error Message */}
              {error && <p style={styles.errorText}>{error}</p>}

              {/* Progress Message */}
              {progressMessage && (
                <div style={styles.progressBox}>
                  <div style={styles.spinner}></div>
                  <span style={styles.progressText}>{progressMessage}</span>
                </div>
              )}

              {/* Result Message */}
              {withdrawResult && (
                <div style={{
                  backgroundColor: withdrawResult.success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: `1px solid ${withdrawResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  borderRadius: '14px',
                  padding: '12px',
                  marginBottom: '12px',
                }}>
                  <p style={withdrawResult.success ? styles.successText : styles.errorText}>
                    {withdrawResult.message}
                  </p>
                  {withdrawResult.tx && (
                    <a
                      href={`https://explorer.solana.com/tx/${withdrawResult.tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.link}
                    >
                      View transaction →
                    </a>
                  )}
                </div>
              )}

              {/* Buttons */}
              {isWithdrawing ? (
                <div style={styles.loadingContainer}>
                  <div style={{ ...styles.spinner, width: '32px', height: '32px', borderWidth: '3px' }}></div>
                  <p style={styles.loadingText}>Generating ZK proof...</p>
                  <p style={styles.loadingSubtext}>
                    This takes 10-20 seconds in your browser.
                    {isMobileWebView && ' Please keep the app open.'}
                  </p>
                </div>
              ) : (
                <div style={styles.buttons}>
                  <button
                    onClick={handleClose}
                    style={{ ...styles.btn, ...styles.btnSecondary }}
                  >
                    {isMobileWebView ? 'Cancel' : 'Close'}
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={!withdrawAddress || !withdrawAmount || currentBalance === 0}
                    style={{
                      ...styles.btn,
                      ...styles.btnPrimary,
                      ...(!withdrawAddress || !withdrawAmount || currentBalance === 0 ? styles.btnDisabled : {}),
                    }}
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
