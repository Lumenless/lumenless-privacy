'use client';

import { useConnector } from '@solana/connector';
import { ChevronDown, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface WalletModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletModal({ open, onOpenChange }: WalletModalProps) {
  const { wallets, select, connecting } = useConnector();
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [isOtherWalletsOpen, setIsOtherWalletsOpen] = useState(false);
  const [recentlyConnected, setRecentlyConnected] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const recent = localStorage.getItem('recentlyConnectedWallet');
    if (recent) setRecentlyConnected(recent);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!target || !(target instanceof Node)) return;
      if (modalRef.current && modalRef.current.contains(target)) {
        return;
      }
      onOpenChange(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onOpenChange, mounted]);

  const handleSelectWallet = async (walletName: string) => {
    setConnectingWallet(walletName);
    try {
      await select(walletName);
      localStorage.setItem('recentlyConnectedWallet', walletName);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setConnectingWallet(null);
    }
  };

  const installedWallets = wallets.filter(w => w.installed);
  const primaryWallets = installedWallets.slice(0, 3);
  const otherWallets = installedWallets.slice(3);

  if (!mounted || !open) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/80 transition-opacity z-50"
        onClick={() => onOpenChange(false)}
      />
      <div 
        ref={modalRef}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-[24px] bg-background p-6 shadow-lg z-50"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connect your wallet</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-[16px] h-8 w-8 p-2 border hover:bg-accent cursor-pointer flex items-center justify-center"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <div className="space-y-4">
          {installedWallets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Detecting wallets...
            </p>
          ) : (
            <>
              {primaryWallets.map(wallet => (
                <button
                  key={wallet.wallet.name}
                  className="w-full flex justify-between items-center p-4 rounded-[16px] border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => handleSelectWallet(wallet.wallet.name)}
                  disabled={connecting || connectingWallet === wallet.wallet.name}
                >
                  <div className="flex items-center gap-3">
                    {wallet.wallet.icon && (
                      <img 
                        src={wallet.wallet.icon} 
                        alt={wallet.wallet.name}
                        className="h-10 w-10 rounded-full" 
                      />
                    )}
                    <span className="font-semibold">{wallet.wallet.name}</span>
                    {recentlyConnected === wallet.wallet.name && (
                      <span className="text-xs text-muted-foreground">Recent</span>
                    )}
                  </div>
                    {connectingWallet === wallet.wallet.name && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    )}
                </button>
              ))}
              {otherWallets.length > 0 && (
                <div>
                  <button
                    onClick={() => setIsOtherWalletsOpen(!isOtherWalletsOpen)}
                    className="w-full flex justify-between items-center px-4 py-3 rounded-[16px] border cursor-pointer hover:bg-accent transition-colors"
                  >
                    <span>Other Wallets</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOtherWalletsOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOtherWalletsOpen && (
                    <div className="grid gap-2 pt-2">
                      {otherWallets.map(wallet => (
                        <button 
                          key={wallet.wallet.name} 
                          className="w-full flex justify-between items-center p-4 rounded-[16px] border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleSelectWallet(wallet.wallet.name)}
                          disabled={connecting || connectingWallet === wallet.wallet.name}
                        >
                          <div className="flex items-center gap-3">
                            {wallet.wallet.icon && (
                              <img 
                                src={wallet.wallet.icon} 
                                alt={wallet.wallet.name}
                                className="h-8 w-8 rounded-full" 
                              />
                            )}
                            <span>{wallet.wallet.name}</span>
                          </div>
                          {connectingWallet === wallet.wallet.name && (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

