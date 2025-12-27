'use client';

import { useConnector, useAccount } from '@solana/connector';
import { Button } from '@/components/ui/button';
import { WalletModal } from '@/components/WalletModal';
import { useEffect, useState } from 'react';

export function WalletButton() {
  const { disconnect, connected } = useConnector();
  const { formatted, copy } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
    );
  }

  if (!connected) {
    return (
      <>
        <Button
          onClick={() => setModalOpen(true)}
          className="!bg-primary hover:!bg-primary/90 !text-primary-foreground"
        >
          Connect Wallet
        </Button>
        <WalletModal open={modalOpen} onOpenChange={setModalOpen} />
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

