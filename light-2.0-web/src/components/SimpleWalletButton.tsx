"use client";

import { useConnector, useAccount } from "@solana/connector";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

export default function SimpleWalletButton() {
  const { account, connected, wallets, select, disconnect } = useConnector();
  const { formatted } = useAccount();
  const publicKey = account ? new PublicKey(account.address) : null;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
    );
  }

  const handleConnect = async () => {
    try {
      // Select the first available wallet
      if (wallets.length > 0) {
        await select(wallets[0].wallet.name);
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error("Failed to disconnect wallet:", error);
    }
  };

  if (connected && publicKey) {
    return (
      <div className="flex flex-col items-center space-y-2">
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium">
            ✅ Wallet Connected
          </p>
          <p className="text-xs text-green-600 mt-1">
            {account?.wallet.name}: {formatted}
          </p>
        </div>
        <button
          onClick={handleDisconnect}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4">
      <button
        onClick={handleConnect}
        className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
      >
        Connect Wallet
      </button>
      <p className="text-sm text-gray-600 text-center">
        Connect your Solana wallet to send private payments
      </p>
    </div>
  );
}
