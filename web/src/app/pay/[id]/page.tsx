'use client';

import { useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletButton } from '@/components/WalletButton';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  SystemProgram,
} from '@solana/web3.js';

const SOL_AMOUNTS = [0.01, 0.05, 0.1, 0.5, 1];

/**
 * Pay link data structure containing PUBLIC keys needed for direct balance deposits.
 * Both keys are SAFE to share in URLs!
 */
interface PayLinkData {
  /** UTXO public key (recipient can spend with their private key) */
  utxoPubkey: string;
  /** Encryption PUBLIC key (payer encrypts with this, only recipient can decrypt) */
  encryptionPublicKey: string;
}

export default function PayPage() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless Pay' }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider connectorConfig={config}>
        <PayView />
      </AppProvider>
    </QueryClientProvider>
  );
}

// Helper to check if a string is a valid Solana wallet address
function isValidWalletAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function PayView() {
  const params = useParams();
  const encodedData = params.id as string;
  
  const { connected } = useConnector();
  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account?.address || null, [account]);
  
  const [amount, setAmount] = useState<string>('0.1');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ tx: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  // Check if the parameter is a wallet address
  const isWalletAddress = useMemo(() => {
    return isValidWalletAddress(encodedData);
  }, [encodedData]);

  // Decode pay link data from URL (only if not a wallet address)
  const payLinkData = useMemo<PayLinkData | null>(() => {
    if (isWalletAddress) return null;
    
    try {
      // URL decode first, then base64 decode
      const urlDecoded = decodeURIComponent(encodedData);
      const decoded = atob(urlDecoded);
      const data = JSON.parse(decoded) as PayLinkData;
      
      if (data.utxoPubkey && data.encryptionPublicKey) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }, [encodedData, isWalletAddress]);

  // Check if this is a valid new-format link
  const isValidLink = payLinkData !== null;

  // Truncate key for display
  const displayId = useMemo(() => {
    if (payLinkData) {
      const key = payLinkData.utxoPubkey;
      return `${key.slice(0, 8)}...${key.slice(-8)}`;
    }
    // Fallback for old format
    if (!encodedData) return '';
    return `${encodedData.slice(0, 6)}...${encodedData.slice(-6)}`;
  }, [payLinkData, encodedData]);

  const handleAmountChange = useCallback((value: string) => {
    // Allow only valid decimal numbers
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  }, []);

  const handlePay = useCallback(async () => {
    if (!signer || !ownerAddress) {
      setError('Please connect your wallet first');
      return;
    }

    if (!isValidLink || !payLinkData) {
      setError('Invalid pay link format');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (parsedAmount < 0.001) {
      setError('Minimum amount is 0.001 SOL');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);
      setSuccess(null);
      setProgressMessage('Loading SDK...');

      const lamports = Math.floor(parsedAmount * LAMPORTS_PER_SOL);
      const connection = new Connection(endpoint, 'confirmed');
      
      // Import SDK utilities - use /utils export to avoid node-localstorage issues
      setProgressMessage('Initializing PrivacyCash...');
      const sdkUtils = await import('privacycash/utils');
      const { deposit, EncryptionService } = sdkUtils;
      
      // Import hasher module
      setProgressMessage('Loading WASM...');
      const hasherModule = await import('@lightprotocol/hasher.rs');
      const { WasmFactory } = hasherModule;
      
      // Load WASM with explicit paths - fetch and pass Response objects
      const wasmModule = await WasmFactory.loadModule({
        wasm: {
          simd: fetch('/hasher_wasm_simd_bg.wasm'),
          sisd: fetch('/light_wasm_hasher_bg.wasm'),
        }
      });
      const lightWasm = wasmModule.create();
      
      // Create encryption service and derive payer's keys
      const encryptionService = new EncryptionService();
      const message = new TextEncoder().encode('Privacy Money account sign in');
      const signature = await signer.signMessage(message);
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
      
      // Convert recipient's hex public key to Uint8Array
      const recipientEncryptionKey = new Uint8Array(
        payLinkData.encryptionPublicKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      
      // Use browser localStorage as storage
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      
      setProgressMessage('Generating ZK proof (this may take a moment)...');
      
      const result = await deposit({
        lightWasm,
        storage,
        keyBasePath: '/circuits/transaction2', // Load from public folder
        publicKey: new PublicKey(ownerAddress),
        connection,
        amount_in_lamports: lamports,
        encryptionService,
        transactionSigner: async (tx: VersionedTransaction) => {
          setProgressMessage('Please sign the transaction...');
          
          // Serialize the VersionedTransaction and pass as Uint8Array
          // The @solana/connector signer has issues with VersionedTransaction objects
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
        recipientUtxoPubkey: payLinkData.utxoPubkey,
        recipientEncryptionKey,
      });

      setSuccess({ tx: result.tx });
    } catch (err) {
      console.error('Payment error:', err);
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  }, [signer, ownerAddress, isValidLink, payLinkData, amount, endpoint]);

  // Handle direct SOL transfer to wallet address (reserved for future use)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleFundWallet = useCallback(async () => {
    if (!signer || !ownerAddress) {
      setError('Please connect your wallet first');
      return;
    }

    if (!isWalletAddress) {
      setError('Invalid wallet address');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (parsedAmount < 0.001) {
      setError('Minimum amount is 0.001 SOL');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);
      setSuccess(null);
      setProgressMessage('Creating transaction...');

      const lamports = Math.floor(parsedAmount * LAMPORTS_PER_SOL);
      const connection = new Connection(endpoint, 'confirmed');
      const destination = new PublicKey(encodedData);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(ownerAddress),
          toPubkey: destination,
          lamports,
        })
      );

      setProgressMessage('Please sign the transaction...');
      const signed = await signer.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });

      await connection.confirmTransaction(signature, 'confirmed');
      setSuccess({ tx: signature });
    } catch (err) {
      console.error('Funding error:', err);
      setError(err instanceof Error ? err.message : 'Funding failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  }, [signer, ownerAddress, isWalletAddress, encodedData, amount, endpoint]);

  // Copy wallet address to clipboard
  const handleCopyAddress = useCallback(async () => {
    if (!isWalletAddress) return;
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(encodedData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      
      // Fallback to execCommand for older browsers or non-HTTPS contexts
      const textArea = document.createElement('textarea');
      textArea.value = encodedData;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Copy command failed');
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      // Show error to user
      setError('Failed to copy to clipboard. Please copy manually.');
      setTimeout(() => setError(null), 3000);
    }
  }, [isWalletAddress, encodedData]);

  // Show funding options if it's a wallet address (Monobank-style: purple gradient + white card, two panels)
  if (isWalletAddress) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center py-8 px-4"
        style={{
          background: 'linear-gradient(180deg, #7c3aed 0%, #5b21b6 35%, #4c1d95 100%)',
        }}
      >
        {/* Single white card - two panels like Monobank */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl overflow-hidden"
        >
          <div className="flex flex-col md:flex-row min-h-[420px]">
            {/* Left panel: Recipient / campaign info */}
            <div className="md:w-[45%] p-8 md:p-10 flex flex-col bg-gray-50/80">
              <Link href="/" className="flex items-center gap-2 mb-8">
                <Image src="/logo.svg" alt="Lumenless" width={28} height={28} />
                <span className="font-semibold text-gray-800 text-lg">Lumenless</span>
              </Link>
              <div className="flex-1 flex flex-col justify-center">
                <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">
                  Fund this wallet
                </h1>
                <p className="text-sm text-gray-500 mb-4">
                  Send SOL, USDC or <a href='https://pump.fun/coin/6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM' target='_blank'>LUMEN</a> to the address below. Use any Solana wallet to scan the QR code or copy the address.
                </p>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Wallet address</p>
                <p className="text-sm text-gray-700 font-mono break-all leading-relaxed">
                  {encodedData}
                </p>
              </div>
            </div>

            {/* Right panel: Payment / fund actions */}
            <div className="md:w-[55%] p-8 md:p-10 flex flex-col justify-center border-t md:border-t-0 md:border-l border-gray-200">
              <p className="text-sm text-gray-500 mb-4">How to fund</p>
              {/* QR code */}
              <div className="flex justify-center mb-6">
                <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-sm">
                  <QRCodeSVG
                    value={encodedData}
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                </div>
              </div>
              <p className="text-center text-xs text-gray-500 mb-6">Scan with any Solana wallet</p>
              {/* Copy address button - primary black button like mono Pay */}
              <button
                type="button"
                onClick={handleCopyAddress}
                className="w-full py-3.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white font-medium text-center transition-colors mb-3"
              >
                {copied ? 'Copied' : 'Copy address'}
              </button>
              {/* Secondary link - like "Enter card details" */}
              <div className="flex items-center justify-center gap-2 pt-2">
                <span className="text-2xl">🔐</span>
                <span className="text-sm text-gray-500">PrivacyCash — coming soon</span>
              </div>
            </div>
          </div>
        </motion.div>

        <footer className="mt-8 text-center text-xs text-white/70">
          © 2025 Lumenless
        </footer>
      </div>
    );
  }

  // Original pay link UI (when not a wallet address)
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: '#0a0a0f' }}>
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ duration: 1 }}
          className="absolute top-10 -right-32 w-[500px] h-[500px] rounded-full blur-3xl"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)' }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="absolute -bottom-20 -left-32 w-[400px] h-[400px] rounded-full blur-3xl"
          style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)' }}
        />
        
        {/* Grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 py-4 border-b border-white/10">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="Lumenless Logo" width={36} height={36} className="brightness-0 invert" />
          <span className="font-semibold text-lg text-white">Lumenless</span>
        </Link>
        <WalletButton />
      </header>

      {/* Main Content */}
      <main className="relative z-10 px-4 md:px-8 py-12 flex flex-col items-center min-h-[calc(100vh-73px-64px)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Send Private Payment
          </h1>
          <p className="text-lg text-gray-400 max-w-xl mx-auto">
            Your payment will be deposited privately to the recipient&apos;s PrivacyCash balance.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="w-full max-w-md"
        >
          <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
            <CardHeader className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 flex items-center justify-center">
                <span className="text-2xl">💸</span>
              </div>
              <CardTitle className="text-white">
                Pay to
              </CardTitle>
              <CardDescription className="text-gray-400 font-mono text-xs">
                {displayId}
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6">
              {!isValidLink ? (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div>
                      <p className="text-red-400 font-medium">Invalid Pay Link</p>
                      <p className="text-gray-400 text-sm mt-1">
                        This pay link appears to be invalid or from an older version. 
                        Please ask the recipient for a new link.
                      </p>
                    </div>
                  </div>
                </div>
              ) : success ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">✅</span>
                      <div>
                        <p className="text-green-400 font-medium">Payment Successful!</p>
                        <p className="text-gray-400 text-sm mt-1">
                          The funds have been sent directly to the recipient&apos;s PrivacyCash balance.
                        </p>
                        <a 
                          href={`https://solscan.io/tx/${success.tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors mt-2 inline-block"
                        >
                          View transaction →
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">🎉</span>
                      <div>
                        <p className="text-white font-medium">No Claim Code Needed!</p>
                        <p className="text-gray-400 text-sm mt-1">
                          The recipient will see this payment in their PrivacyCash balance automatically.
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => setSuccess(null)}
                    variant="outline"
                    className="w-full border-white/20 text-white hover:bg-white/10"
                  >
                    Send Another Payment
                  </Button>
                </div>
              ) : (
                <>
                  {/* Amount Input */}
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Amount (SOL)</label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={amount}
                        onChange={(e) => handleAmountChange(e.target.value)}
                        placeholder="0.00"
                        className="bg-white/10 border-white/20 text-white text-2xl font-bold text-center h-16 pr-16"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <Image
                          src="/sol.svg"
                          alt="SOL"
                          width={24}
                          height={24}
                          className="opacity-80"
                        />
                        <span className="text-gray-400 font-medium">SOL</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Amount Buttons */}
                  <div className="grid grid-cols-5 gap-2">
                    {SOL_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setAmount(amt.toString())}
                        className={`h-10 px-3 rounded-md border text-sm font-medium transition-colors
                          ${parseFloat(amount) === amt 
                            ? 'bg-violet-600 border-violet-500 text-white' 
                            : 'bg-white/5 border-white/20 text-white hover:bg-white/10'
                          }`}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>

                  {error && (
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-red-400 text-sm">{error}</p>
                    </div>
                  )}

                  {!connected ? (
                    <div className="text-center py-4">
                      <p className="text-gray-400 mb-4 text-sm">Connect your wallet to send a payment</p>
                      <WalletButton />
                    </div>
                  ) : (
                    <Button
                      onClick={handlePay}
                      className="w-full h-14 text-lg bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-700 hover:to-violet-700 text-white"
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          {progressMessage || 'Processing...'}
                        </span>
                      ) : (
                        `Pay ${amount || '0'} SOL`
                      )}
                    </Button>
                  )}

                  {/* Info Box */}
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-start gap-3">
                      <span className="text-lg">🔐</span>
                      <div>
                        <p className="text-gray-300 text-sm font-medium">Direct to Balance</p>
                        <p className="text-gray-500 text-xs mt-1">
                          This payment goes directly to the recipient&apos;s PrivacyCash balance.
                          No claim codes needed - funds appear instantly and privately!
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Back to Pay Links */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8"
        >
          <a 
            href="/pay-links"
            className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-2"
          >
            ← Create your own pay link
          </a>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 text-center text-sm text-gray-500 border-t border-white/10">
        <p>© 2025 Lumenless. Powered by PrivacyCash.</p>
      </footer>
    </div>
  );
}
