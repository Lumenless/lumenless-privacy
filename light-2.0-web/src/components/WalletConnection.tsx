"use client";

import { useEffect, useState } from "react";
import WalletStatus from "./WalletStatus";
import { WalletButton } from "./WalletButton";

export default function WalletConnection() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex flex-col items-center space-y-4">
        <div className="h-10 w-32 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4">
      <WalletButton />
      <WalletStatus />
    </div>
  );
}
