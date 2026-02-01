'use client';

import { useConnector, useAccount } from '@solana/connector';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';

export function WalletButton() {
  const { select, disconnect, connected, wallets, connecting } = useConnector();
  const { formatted, copy } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debug: log wallets
  useEffect(() => {
    if (mounted) {
      console.log('Available wallets:', wallets);
      console.log('Connected:', connected);
      console.log('Connecting:', connecting);
    }
  }, [mounted, wallets, connected, connecting]);

  const handleSelectWallet = async (walletName: string) => {
    console.log('=== SELECTING WALLET ===', walletName);
    try {
      setShowModal(false);
      await select(walletName);
      console.log('Wallet selected successfully');
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  if (!mounted) {
    return (
      <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
    );
  }

  if (!connected) {
    return (
      <>
        <Button
          onClick={() => setShowModal(true)}
          className="!bg-primary hover:!bg-primary/90 !text-primary-foreground"
        >
          {connecting ? 'Connecting...' : 'Connect Wallet'}
        </Button>

        {showModal && createPortal(
          <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
            onClick={() => setShowModal(false)}
          >
            <div 
              className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-80 max-h-96 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Connect Wallet
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl"
                >
                  ×
                </button>
              </div>
              <div className="p-2 max-h-72 overflow-y-auto">
                {wallets.length > 0 ? (
                  wallets.map((walletInfo) => (
                    <div
                      key={walletInfo.wallet.name}
                      onClick={() => handleSelectWallet(walletInfo.wallet.name)}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                      role="button"
                      tabIndex={0}
                    >
                      {walletInfo.wallet.icon && (
                        <Image
                          src={walletInfo.wallet.icon}
                          alt={walletInfo.wallet.name}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-lg"
                          unoptimized
                        />
                      )}
                      <span className="text-base font-medium text-gray-900 dark:text-gray-100">
                        {walletInfo.wallet.name}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      No wallets detected
                    </p>
                    <div className="flex flex-col gap-2">
                      <a 
                        href="https://solflare.com" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Install Solflare
                      </a>
                      <a 
                        href="https://phantom.app" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Install Phantom
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={copy}
        variant="outline"
        className="font-mono text-sm"
      >
        {formatted}
      </Button>
      <Button
        onClick={disconnect}
        variant="outline"
      >
        Disconnect
      </Button>
    </div>
  );
}

