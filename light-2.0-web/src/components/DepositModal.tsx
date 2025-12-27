'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConnector } from '@solana/connector';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

interface DepositModalProps {
  visible: boolean;
  onClose: () => void;
  balance: number | null; // balance in lamports
}

export function DepositModal({ visible, onClose, balance }: DepositModalProps) {
  const { account } = useConnector();
  const publicKey = account ? new PublicKey(account.address) : null;
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);
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

  const balanceSol = balance !== null ? (balance / LAMPORTS_PER_SOL).toFixed(4) : '0.0000';
  const usdValue = amount ? (parseFloat(amount) * 192.27).toFixed(2) : '0.00';

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

  const copyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-xl font-bold text-gray-900">Deposit</h2>
            <div className="w-6" /> {/* Spacer for centering */}
          </div>

          {/* Amount Input Section */}
          <div className="p-6 text-center">
            <div className="mb-2">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
                placeholder="0"
                className="text-6xl font-bold text-gray-900 text-center w-full bg-transparent border-none outline-none focus:ring-0"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <span className="text-lg">${usdValue}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
          </div>

          {/* Asset Selection Card */}
          <div className="px-6 pb-6">
            <div className="flex items-center gap-3 p-4 border rounded-xl bg-gray-50">
              <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 397.7 311.7" fill="none">
                  <linearGradient id="solGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00FFA3" />
                    <stop offset="100%" stopColor="#DC1FFF" />
                  </linearGradient>
                  <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solGradient)"/>
                  <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solGradient)"/>
                  <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solGradient)"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900">Solana</div>
                <div className="text-sm text-gray-500">{balanceSol} SOL</div>
              </div>
            </div>
          </div>

          {/* Deposit Address Section */}
          <div className="px-6 pb-6">
            <div className="text-sm text-gray-600 mb-2">Your Deposit Address:</div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <code className="text-xs text-gray-900 flex-1 break-all">
                {publicKey?.toBase58()}
              </code>
              <button
                onClick={copyAddress}
                className="text-blue-600 hover:text-blue-700 transition-colors"
              >
                {copied ? (
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Send SOL to this address on Solana devnet. Get test SOL from{' '}
              <a href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                faucet.solana.com
              </a>
            </div>
          </div>

          {/* Action Button */}
          <div className="p-6 pt-0">
            <Button
              onClick={onClose}
              className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold rounded-xl"
            >
              Done
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

