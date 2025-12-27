'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConnector } from '@solana/connector';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, Connection, clusterApiUrl } from '@solana/web3.js';

interface WithdrawModalProps {
  visible: boolean;
  onClose: () => void;
  balance: number | null; // balance in lamports
  onSuccess: () => void;
}

export function WithdrawModal({ visible, onClose, balance, onSuccess }: WithdrawModalProps) {
  // Create connection manually
  const connection = useMemo(() => new Connection(clusterApiUrl('devnet'), 'confirmed'), []);

  const { account, signTransaction } = useConnector();
  const publicKey = account ? new PublicKey(account.address) : null;
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onClose]);

  const balanceSol = balance !== null ? balance / LAMPORTS_PER_SOL : 0;
  const amountNum = parseFloat(amount) || 0;
  const usdValue = (amountNum * 192.27).toFixed(2);
  const insufficientBalance = amountNum > balanceSol;

  const sanitizeAmount = useCallback((raw: string) => {
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
    const dotIndex = result.indexOf('.');
    if (dotIndex !== -1) {
      const intPart = result.slice(0, dotIndex + 1);
      const fracPart = result.slice(dotIndex + 1, dotIndex + 1 + 9);
      result = intPart + fracPart;
    }
    if (result.startsWith('.')) result = '0' + result;
    return result;
  }, []);

  const handleWithdraw = async () => {
    if (!publicKey || !recipient || !amount) {
      setError('Please fill in all fields');
      return;
    }

    if (insufficientBalance) {
      setError('Insufficient balance');
      return;
    }

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(recipient);
    } catch {
      setError('Invalid recipient address');
      return;
    }

    const lamports = Math.floor(amountNum * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
      SystemProgram.transfer({ 
        fromPubkey: publicKey, 
        toPubkey: recipientPubkey, 
        lamports 
      })
    );
    transaction.feePayer = publicKey;

    try {
      setIsProcessing(true);
      setError('');
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;

      // Sign transaction using ConnectorKit
      if (!signTransaction) {
        setError('Wallet does not support signing transactions');
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
      
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      
      onSuccess();
      onClose();
      setAmount('');
      setRecipient('');
    } catch (err: unknown) {
      console.error(err);
      setError('Transaction failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      {/* Mobile Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40 sm:hidden" onClick={onClose} />
      
      <div ref={modalRef} className="fixed sm:absolute left-0 right-0 sm:left-auto sm:right-0 top-auto bottom-0 sm:top-full sm:bottom-auto mt-0 sm:mt-2 w-full sm:w-96 z-50">
        <Card className="bg-white shadow-2xl rounded-t-3xl sm:rounded-2xl overflow-hidden max-h-[90vh] sm:max-h-none overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900"
              disabled={isProcessing}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-xl font-bold text-gray-900">Withdraw</h2>
            <div className="w-6" /> {/* Spacer for centering */}
          </div>

          {/* Amount Input Section */}
          <div className="p-6 text-center">
            <div className="mb-2">
              <input
                type="text"
                value={amount}
                onChange={(e) => {
                  setAmount(sanitizeAmount(e.target.value));
                  setError('');
                }}
                placeholder="0"
                className="text-6xl font-bold text-gray-900 text-center w-full bg-transparent border-none outline-none focus:ring-0"
                autoFocus
                disabled={isProcessing}
              />
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg text-gray-500">${usdValue}</span>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            {insufficientBalance && amount && (
              <div className="text-red-600 font-semibold mt-2">
                INSUFFICIENT BALANCE
              </div>
            )}
            {error && !insufficientBalance && (
              <div className="text-red-600 text-sm mt-2">
                {error}
              </div>
            )}
          </div>

          {/* Asset Card */}
          <div className="px-6 pb-6">
            <div className="flex items-center gap-3 p-4 border rounded-xl bg-gray-50">
              <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 397.7 311.7" fill="none">
                  <linearGradient id="solGradientWithdraw" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00FFA3" />
                    <stop offset="100%" stopColor="#DC1FFF" />
                  </linearGradient>
                  <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solGradientWithdraw)"/>
                  <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solGradientWithdraw)"/>
                  <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solGradientWithdraw)"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900">Solana</div>
                <div className={`text-sm ${insufficientBalance && amount ? 'text-red-600' : 'text-gray-500'}`}>
                  {balanceSol.toFixed(4)} SOL
                </div>
              </div>
            </div>
          </div>

          {/* Recipient Address Input */}
          <div className="px-6 pb-6">
            <label className="text-sm text-gray-600 mb-2 block">Recipient Address</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setError('');
              }}
              placeholder="Enter Solana wallet address"
              className="w-full p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isProcessing}
            />
          </div>

          {/* Action Button */}
          <div className="p-6 pt-0">
            <Button
              onClick={handleWithdraw}
              disabled={isProcessing || !amount || !recipient || insufficientBalance}
              className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold rounded-xl disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : 'Confirm Withdrawal'}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

