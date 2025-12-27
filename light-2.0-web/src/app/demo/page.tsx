'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { clusterApiUrl, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, Connection } from '@solana/web3.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector } from '@solana/connector';
import { ProfilePopup } from '@/components/ProfilePopup';
import { DepositModal } from '@/components/DepositModal';
import { WithdrawModal } from '@/components/WithdrawModal';
import { WalletButton } from '@/components/WalletButton';

export default function AppPage() {
  // Configure ConnectorKit
  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless' }), []);

  return (
    <AppProvider connectorConfig={config}>
      <SendSolView />
    </AppProvider>
  );
}

function SendSolView() {
  // Create connection manually
  const connection = useMemo(() => new Connection(clusterApiUrl('devnet'), 'confirmed'), []);

  const { account, connected, signTransaction } = useConnector();
  const publicKey = account ? new PublicKey(account.address) : null;

  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [toAddress, setToAddress] = useState<string>('');
  const [amountSol, setAmountSol] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<string>('');
  const ADDRESS_ERROR = 'Enter a valid Solana address.';
  const AMOUNT_ERROR = 'Enter a valid SOL amount.';
  const [toast, setToast] = useState<{ message: string; href?: string } | null>(null);
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

  // Sanitize amount input to allow only digits and a single decimal point.
  const sanitizeAmount = useCallback((raw: string) => {
    // Replace commas with dots and strip invalid chars
    const replaced = raw.replace(/,/g, '.');
    let result = '';
    let dotSeen = false;
    for (const ch of replaced) {
      if (ch >= '0' && ch <= '9') {
        result += ch;
      } else if (ch === '.' && !dotSeen) {
        dotSeen = true;
        result += ch;
      }
    }
    // Limit to max 9 digits after the decimal point
    const dotIndex = result.indexOf('.');
    if (dotIndex !== -1) {
      const intPart = result.slice(0, dotIndex + 1);
      const fracPart = result.slice(dotIndex + 1, dotIndex + 1 + 9);
      result = intPart + fracPart;
    }
    if (result.startsWith('.')) result = '0' + result;
    return result;
  }, []);

  // Fetch balance when publicKey changes
  useEffect(() => {
    if (!publicKey) {
      setBalanceLamports(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        if (!cancelled) setBalanceLamports(lamports);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  const setUseMax = useCallback(() => {
    if (balanceLamports === null) return;
    const buffer = 5000; // small buffer for fees
    const maxLamports = Math.max(0, balanceLamports - buffer);
    setAmountSol((maxLamports / LAMPORTS_PER_SOL).toString());
  }, [balanceLamports]);

  const sendSol = useCallback(async () => {
    if (!connected || !publicKey) {
      setStatus('Connect your wallet first.');
      return;
    }
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(toAddress);
    } catch {
      setStatus(ADDRESS_ERROR);
      return;
    }
    const amount = Number(sanitizeAmount(amountSol));
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus(AMOUNT_ERROR);
      return;
    }
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipient, lamports })
    );
    transaction.feePayer = publicKey;
    try {
      setIsSending(true);
      setStatus('Preparing transaction...');
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;

      // Sign transaction using ConnectorKit
      if (!signTransaction) {
        setStatus('Wallet does not support signing transactions');
        return;
      }

      const signedTransaction = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      // Send the signed transaction
      const signature = await connection.sendRawTransaction(
        Buffer.from(signedTransaction, 'base64'),
        { skipPreflight: false }
      );

      // Wait for confirmation
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      setToast({
        message: 'Transaction confirmed',
        href: `https://solscan.io/tx/${signature}?cluster=devnet`,
      });
      // Auto-hide toast after a few seconds
      setTimeout(() => setToast(null), 4500);
      setTimeout(async () => {
        try {
          const lamportsAfter = await connection.getBalance(publicKey);
          setBalanceLamports(lamportsAfter);
        } catch {}
      }, 3000);
    } catch (err: unknown) {
      console.error(err);
      setStatus('Transaction failed. See console for details.');
    } finally {
      setIsSending(false);
    }
  }, [connected, publicKey, toAddress, amountSol, connection, signTransaction, sanitizeAmount]);

  const balanceSol = useMemo(() => {
    return balanceLamports === null ? null : balanceLamports / LAMPORTS_PER_SOL;
  }, [balanceLamports]);
  const isAddressError = status === ADDRESS_ERROR;
  const isAmountError = status === AMOUNT_ERROR;

  const onPrimaryButtonClick = useCallback(() => {
    if (!connected) {
      return;
    }
    void sendSol();
  }, [connected, sendSol]);

  const handleDeposit = useCallback(() => {
    setDepositModalVisible(true);
  }, []);

  const handleWithdraw = useCallback(() => {
    setWithdrawModalVisible(true);
  }, []);

  const handleWithdrawSuccess = useCallback(() => {
    setToast({
      message: 'Withdrawal completed successfully',
    });
    setTimeout(() => setToast(null), 4500);
    // Refresh balance
    setTimeout(async () => {
      if (publicKey) {
        try {
          const lamports = await connection.getBalance(publicKey);
          setBalanceLamports(lamports);
        } catch {}
      }
    }, 2000);
  }, [publicKey, connection]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4">
        <div className="flex items-center gap-2">
          <Image src="/logo.svg" alt="Lumenless Logo" width={36} height={36} />
          <span className="font-semibold text-lg">Lumenless</span>
        </div>
        <div className="flex items-center gap-3">
          {connected ? (
            <ProfilePopup 
              balance={balanceLamports}
              onDeposit={handleDeposit}
              onWithdraw={handleWithdraw}
              depositModalVisible={depositModalVisible}
              withdrawModalVisible={withdrawModalVisible}
            >
              {/* Deposit Modal */}
              <DepositModal 
                visible={depositModalVisible}
                onClose={() => setDepositModalVisible(false)}
                balance={balanceLamports}
              />

              {/* Withdraw Modal */}
              <WithdrawModal 
                visible={withdrawModalVisible}
                onClose={() => setWithdrawModalVisible(false)}
                balance={balanceLamports}
                onSuccess={handleWithdrawSuccess}
              />
            </ProfilePopup>
          ) : (
            <WalletButton />
          )}
        </div>
      </header>

      {/* Main */}
      <main className="px-4 md:px-8 py-8 flex justify-center">
        <Card className="w-full max-w-2xl p-6 border border-border shadow-xl">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Sending privately</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Lumenless works on Solana Devnet{' '}<a className="underline" href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer">Faucet here</a>.
          </p>

          <div className="space-y-6">
            {/* Token + amount panel */}
            <div className={`rounded-xl border bg-card/50 p-4 ${isAmountError ? 'border-destructive ring-destructive/20 ring-2' : 'border-border'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#00D18C] p-[1px]">
                  <div className="flex items-center gap-2 bg-background rounded-full px-3 py-1.5">
                    <span className="inline-flex items-center justify-center size-6 rounded-full bg-black">
                      <Image src="/sol.svg" alt="SOL" width={14} height={14} />
                    </span>
                    <span className="font-semibold">SOL</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {balanceSol !== null && (
                    <span className="text-xs text-muted-foreground">Balance: {balanceSol.toFixed(6)} SOL</span>
                  )}
                  <Button type="button" size="sm" variant="secondary" onClick={setUseMax} disabled={balanceSol === null}>
                    MAX
                  </Button>
                </div>
              </div>
              <div className="pt-2">
                <input
                  placeholder="0"
                  inputMode="decimal"
                  value={amountSol}
                  aria-invalid={isAmountError || undefined}
                  onChange={(e) => {
                    if (isAmountError) setStatus('');
                    setAmountSol(sanitizeAmount(e.target.value));
                  }}
                  onBlur={() => {
                    // Normalize trailing dot to a valid number
                    if (amountSol === '.' || amountSol === '') {
                      setAmountSol('0');
                      return;
                    }
                    // Trim leading zeros (keep single zero if before dot)
                    const [intPart, fracPart] = amountSol.split('.');
                    const normalizedInt = String(Number(intPart || '0'));
                    const normalized = fracPart !== undefined ? `${normalizedInt}.${fracPart}` : normalizedInt;
                    setAmountSol(normalized);
                  }}
                  className="w-full bg-transparent border-0 outline-none text-right text-6xl font-semibold tracking-tight placeholder:text-muted-foreground focus:ring-0"
                />
              </div>
              {isAmountError && (
                <p className="mt-2 text-sm text-destructive/80">{AMOUNT_ERROR}</p>
              )}
            </div>

            {/* Recipient row */}
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="text-sm text-muted-foreground mb-2">To</div>
              <Input
                placeholder="Enter recipient address (a valid Solana wallet address)"
                value={toAddress}
                aria-invalid={isAddressError || undefined}
                onChange={(e) => {
                  if (isAddressError) setStatus('');
                  setToAddress(e.target.value);
                }}
              />
              {isAddressError && (
                <p className="mt-1 text-sm text-destructive/80">{ADDRESS_ERROR}</p>
              )}
            </div>

            <div className="pt-2">
              <Button onClick={onPrimaryButtonClick} disabled={isSending} className="w-full h-12 text-base">
                {connected ? (isSending ? 'Sending...' : 'Send') : 'Connect Wallet'}
              </Button>
            </div>
          </div>
        </Card>
      </main>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <a
            href={toast.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg bg-green-600 text-white px-4 py-3 shadow-lg hover:bg-green-500 transition-colors"
          >
            <span className="font-medium">{toast.message}</span>
            {toast.href && <span className="text-white/80 underline">Explorer</span>}
          </a>
        </div>
      )}
    </div>
  );
}

