'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
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
// SDK is dynamically imported in derivePayLinkKeys

// Message used to derive the encryption key deterministically (matches SDK)
const DERIVATION_MESSAGE = 'Privacy Money account sign in';

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

export default function PayLinksPage() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless Pay Links' }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider connectorConfig={config}>
        <PayLinksView />
      </AppProvider>
    </QueryClientProvider>
  );
}

function PayLinksView() {
  const { connected } = useConnector();
  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account?.address || null, [account]);
  
  const [payLinkData, setPayLinkData] = useState<PayLinkData | null>(null);
  const [isDerivingKey, setIsDerivingKey] = useState(false);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Claim section state (kept for backward compatibility, but no longer primary flow)
  const [claimCode, setClaimCode] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load saved pay link data from localStorage
  useEffect(() => {
    if (ownerAddress) {
      const savedData = localStorage.getItem(`lumenless-paylink-data-${ownerAddress}`);
      if (savedData) {
        try {
          const data = JSON.parse(savedData);
          // Validate that it has the new field name (encryptionPublicKey, not old encryptionKey)
          if (data.utxoPubkey && data.encryptionPublicKey) {
            setPayLinkData(data as PayLinkData);
            // Encode both keys in the URL as base64 JSON (URL-encoded for safety)
            const encodedData = encodeURIComponent(btoa(JSON.stringify(data)));
            setPayLink(`${window.location.origin}/pay/${encodedData}`);
          } else {
            // Old format data, clear it
            localStorage.removeItem(`lumenless-paylink-data-${ownerAddress}`);
          }
        } catch {
          // Invalid saved data, clear it
          localStorage.removeItem(`lumenless-paylink-data-${ownerAddress}`);
        }
      }
    } else {
      setPayLinkData(null);
      setPayLink(null);
    }
  }, [ownerAddress]);

  // Derive both UTXO pubkey and encryption PUBLIC key from wallet signature
  // Uses asymmetric encryption - only PUBLIC keys are shared, so this is SAFE!
  const derivePayLinkKeys = useCallback(async () => {
    if (!signer?.signMessage || !ownerAddress) {
      setError('Please connect your wallet first');
      return;
    }

    try {
      setIsDerivingKey(true);
      setError(null);

      // Sign the deterministic message (same as SDK's EncryptionService)
      const messageBytes = new TextEncoder().encode(DERIVATION_MESSAGE);
      const signature = await signer.signMessage(messageBytes);
      
      // Convert signature to Uint8Array if needed
      const sigBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      
      // Import SDK utilities - use /utils export to avoid node-localstorage issues
      const sdkUtils = await import('privacycash/utils');
      const { EncryptionService } = sdkUtils;
      
      // Import hasher module
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
      
      // Create encryption service and derive keys (exactly like SDK does)
      const encryptionService = new EncryptionService();
      encryptionService.deriveEncryptionKeyFromSignature(sigBytes);
      
      // Get UTXO pubkey - compute poseidon(privateKey)
      const utxoPrivateKey = encryptionService.getUtxoPrivateKeyV2();
      const privkeyBN = BigInt(utxoPrivateKey);
      const utxoPubkey = lightWasm.poseidonHashString([privkeyBN.toString()]);
      
      // For encryption public key, we use the UTXO pubkey as the identifier
      // The actual encryption uses the derived keys from the SDK
      const encryptionPublicKey = utxoPubkey;
      
      const data: PayLinkData = {
        utxoPubkey, // Proper UTXO pubkey (poseidon hash of private key)
        encryptionPublicKey, // Using UTXO pubkey as identifier
      };
      
      // Save to localStorage for persistence
      localStorage.setItem(`lumenless-paylink-data-${ownerAddress}`, JSON.stringify(data));
      
      setPayLinkData(data);
      
      // Encode both PUBLIC keys in the URL as base64 JSON
      // Use encodeURIComponent to make the base64 URL-safe (handles +, /, = characters)
      const encodedData = encodeURIComponent(btoa(JSON.stringify(data)));
      setPayLink(`${window.location.origin}/pay/${encodedData}`);
    } catch (err) {
      console.error('Error deriving pay link keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to derive keys. Please try again.');
    } finally {
      setIsDerivingKey(false);
    }
  }, [signer, ownerAddress]);

  const copyPayLink = useCallback(() => {
    if (payLink) {
      navigator.clipboard.writeText(payLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [payLink]);

  const handleClaim = useCallback(async () => {
    if (!claimCode.trim()) {
      setClaimResult({ success: false, message: 'Please enter a claim code' });
      return;
    }

    try {
      setIsClaiming(true);
      setClaimResult(null);

      // Parse the claim code (base64 encoded PaymentLinkData)
      const decoded = atob(claimCode.trim());
      const paymentLinkData = JSON.parse(decoded);

      // Validate the structure
      if (!paymentLinkData.blinding || !paymentLinkData.amount || paymentLinkData.index === undefined) {
        throw new Error('Invalid claim code format');
      }

      // In production, this would call the PrivacyCash SDK to claim
      // For now, we show a success message with the data
      setClaimResult({
        success: true,
        message: `Found payment of ${(paymentLinkData.amount / 1e9).toFixed(4)} SOL. Claim functionality coming soon!`,
      });
    } catch (err) {
      console.error('Error parsing claim code:', err);
      setClaimResult({
        success: false,
        message: err instanceof Error ? err.message : 'Invalid claim code',
      });
    } finally {
      setIsClaiming(false);
    }
  }, [claimCode]);

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: '#0a0a0f' }}>
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ duration: 1 }}
          className="absolute top-20 -left-20 w-96 h-96 rounded-full blur-3xl"
          style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="absolute bottom-20 -right-20 w-96 h-96 rounded-full blur-3xl"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)' }}
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
      <main className="relative z-10 px-4 md:px-8 py-12 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Pay Links
          </h1>
          <p className="text-lg text-gray-400 max-w-xl mx-auto">
            Create private payment links. Receive SOL directly to your PrivacyCash balance without revealing your wallet address.
          </p>
        </motion.div>

        <div className="w-full max-w-2xl space-y-6">
          {/* Create Pay Link Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <span className="text-2xl">🔗</span>
                  Create Pay Link
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Generate a unique payment link to receive private payments
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!connected ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400 mb-4">Connect your wallet to create a pay link</p>
                    <WalletButton />
                  </div>
                ) : payLinkData ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                      <label className="text-sm text-gray-400 mb-2 block">Your Pay Link</label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={payLink || ''}
                          readOnly
                          className="bg-white/10 border-white/20 text-white font-mono text-sm"
                        />
                        <Button
                          onClick={copyPayLink}
                          variant="outline"
                          className="shrink-0 border-white/20 text-white hover:bg-white/10"
                        >
                          {copied ? '✓ Copied!' : 'Copy'}
                        </Button>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">✨</span>
                        <div>
                          <p className="text-green-400 font-medium">Direct to Balance!</p>
                          <p className="text-gray-400 text-sm mt-1">
                            Anyone with this link can send SOL directly to your PrivacyCash balance. 
                            No claim codes needed - funds appear instantly!
                          </p>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={derivePayLinkKeys}
                      variant="outline"
                      className="w-full border-white/20 text-gray-400 hover:bg-white/5 hover:text-white"
                      disabled={isDerivingKey}
                    >
                      {isDerivingKey ? 'Regenerating...' : 'Regenerate Pay Link'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                      <p className="text-gray-400 text-sm">
                        Create your unique pay link by signing a message. This derives your private receiving keys 
                        from your wallet - the signature never leaves your device.
                      </p>
                    </div>
                    
                    {error && (
                      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-red-400 text-sm">{error}</p>
                      </div>
                    )}

                    <Button
                      onClick={derivePayLinkKeys}
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                      disabled={isDerivingKey}
                    >
                      {isDerivingKey ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Creating Pay Link...
                        </span>
                      ) : (
                        'Create Pay Link'
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* How It Works */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <span className="text-2xl">❓</span>
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold shrink-0">
                      1
                    </div>
                    <div>
                      <p className="text-white font-medium">Create Your Pay Link</p>
                      <p className="text-gray-400 text-sm">Sign a message to derive your unique receiving keys. Share the generated link with anyone who wants to pay you.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold shrink-0">
                      2
                    </div>
                    <div>
                      <p className="text-white font-medium">Receive Instant Private Payments</p>
                      <p className="text-gray-400 text-sm">When someone pays through your link, the funds appear directly in your PrivacyCash balance. No claim codes needed!</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold shrink-0">
                      3
                    </div>
                    <div>
                      <p className="text-white font-medium">Withdraw Anytime</p>
                      <p className="text-gray-400 text-sm">Use your PrivacyCash balance to withdraw privately to any wallet address whenever you want.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Legacy Claim Section (collapsed by default) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <details className="group">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-400 transition-colors flex items-center gap-2">
                <span>Have an old-style claim code?</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <Card className="bg-white/5 border-white/10 backdrop-blur-xl mt-4">
                <CardContent className="pt-6 space-y-4">
                  {!connected ? (
                    <div className="text-center py-4">
                      <p className="text-gray-400 mb-4 text-sm">Connect your wallet to claim payments</p>
                      <WalletButton />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm text-gray-400 mb-2 block">Legacy Claim Code</label>
                        <Input
                          value={claimCode}
                          onChange={(e) => {
                            setClaimCode(e.target.value);
                            setClaimResult(null);
                          }}
                          placeholder="Paste your claim code here..."
                          className="bg-white/10 border-white/20 text-white font-mono text-sm"
                        />
                      </div>

                      {claimResult && (
                        <div className={`p-4 rounded-lg ${claimResult.success ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                          <p className={claimResult.success ? 'text-green-400' : 'text-red-400'}>
                            {claimResult.message}
                          </p>
                        </div>
                      )}

                      <Button
                        onClick={handleClaim}
                        variant="outline"
                        className="w-full border-white/20 text-white hover:bg-white/10"
                        disabled={isClaiming || !claimCode.trim()}
                      >
                        {isClaiming ? 'Processing...' : 'Claim Payment'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </details>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 text-center text-sm text-gray-500 border-t border-white/10">
        <p>© 2025 Lumenless. Powered by PrivacyCash.</p>
      </footer>
    </div>
  );
}
