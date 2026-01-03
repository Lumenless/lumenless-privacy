'use client';

import { useConnector, useAccount } from '@solana/connector';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export function WalletButton() {
  const { select, disconnect, connected, wallets } = useConnector();
  const { formatted, copy } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConnect = async () => {
    try {
      // Select the first available wallet
      if (wallets.length > 0) {
        await select(wallets[0].wallet.name);
      }
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
      <Button
        onClick={handleConnect}
        className="!bg-primary hover:!bg-primary/90 !text-primary-foreground"
      >
        Connect Wallet
      </Button>
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

