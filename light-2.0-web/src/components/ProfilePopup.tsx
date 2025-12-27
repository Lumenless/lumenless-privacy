'use client';

import { useConnector, useAccount } from '@solana/connector';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

interface ProfilePopupProps {
  balance: number | null; // balance in lamports
  onDeposit: () => void;
  onWithdraw: () => void;
  depositModalVisible: boolean;
  withdrawModalVisible: boolean;
  children?: React.ReactNode;
}

export function ProfilePopup({ balance, onDeposit, onWithdraw, depositModalVisible, withdrawModalVisible, children }: ProfilePopupProps) {
  const { account, disconnect } = useConnector();
  const { formatted } = useAccount();
  const publicKey = account ? new PublicKey(account.address) : null;
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!publicKey) return null;

  const shortKey = `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`;
  const balanceSol = balance !== null ? (balance / LAMPORTS_PER_SOL).toFixed(4) : '0.0000';

  const copyAddress = () => {
    navigator.clipboard.writeText(publicKey.toBase58());
    // You could add a toast notification here
  };

  return (
    <div className="relative" ref={popupRef}>
      {/* Trigger Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className="flex items-center gap-2"
      >
        <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
          <span className="text-purple-600 text-xs font-bold">
            {publicKey.toBase58().slice(0, 1).toUpperCase()}
          </span>
        </div>
        <span className="hidden sm:inline">{shortKey}</span>
      </Button>

      {/* Mobile Backdrop */}
      {isOpen && !depositModalVisible && !withdrawModalVisible && (
        <div className="fixed inset-0 bg-black/20 z-40 sm:hidden" onClick={() => setIsOpen(false)} />
      )}

      {/* Popup Card */}
      {isOpen && !depositModalVisible && !withdrawModalVisible && (
        <Card className="fixed sm:absolute left-0 right-0 sm:left-auto sm:right-0 top-auto bottom-0 sm:top-full sm:bottom-auto mt-0 sm:mt-2 w-full sm:w-96 p-6 shadow-2xl z-50 bg-white rounded-t-3xl sm:rounded-2xl">
          {/* Header with wallet address */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <span className="text-purple-600 font-bold">
                  {publicKey.toBase58().slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{shortKey}</span>
                  <button
                    onClick={copyAddress}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    title="Copy address"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Balance Display */}
          <div className="mb-6">
            <div className="text-sm text-gray-500 mb-1">Balance</div>
            <div className="text-3xl font-bold text-gray-900">{balanceSol} SOL</div>
          </div>

          {/* Deposit/Withdraw Buttons */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Button
              onClick={() => {
                setIsOpen(false);
                onDeposit();
              }}
              variant="outline"
              className="flex flex-col items-center justify-center h-20 gap-2"
            >
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-medium">Deposit</span>
            </Button>

            <Button
              onClick={() => {
                setIsOpen(false);
                onWithdraw();
              }}
              variant="outline"
              className="flex flex-col items-center justify-center h-20 gap-2"
            >
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <span className="text-sm font-medium">Withdraw</span>
            </Button>
          </div>

          {/* Tokens Section */}
          <div className="border-t pt-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-900">Tokens</span>
              <span className="text-xs text-gray-400">No tokens found</span>
            </div>
          </div>

          {/* Disconnect Button */}
          <Button
            onClick={() => {
              disconnect();
              setIsOpen(false);
            }}
            variant="outline"
            className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Disconnect Wallet
          </Button>
        </Card>
      )}

      {/* Render deposit/withdraw modals in the same position */}
      {children}
    </div>
  );
}

