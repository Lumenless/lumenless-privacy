'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import { clusterApiUrl, PublicKey } from '@solana/web3.js';
import { Card } from '@/components/ui/card';
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDomainsForOwner } from '@bonfida/sns-react';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function AppPage() {
  // SNS domains are on mainnet, not devnet
  // Use a custom RPC endpoint if provided via environment variable
  // Otherwise, use the public endpoint (may be rate-limited)
  const endpoint = useMemo(() => {
    // Next.js bundles NEXT_PUBLIC_* env vars at build time
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (customRpc) {
      return customRpc;
    }
    // Default public endpoint (has rate limits - consider using Helius, QuickNode, etc.)
    return clusterApiUrl('mainnet-beta');
  }, []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new BackpackWalletAdapter(), new SolflareWalletAdapter()],
    []
  );
  
  // Create a QueryClient instance for React Query
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
        <WalletProvider wallets={wallets} autoConnect={true}>
          <WalletModalProvider>
            <DomainsView />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}

function DomainItem({ domain, pubkey }: { domain: string; pubkey: PublicKey }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 flex items-center justify-between hover:bg-card/80 transition-colors">
      <div className="flex flex-col">
        <span className="font-medium text-lg">
          {domain}.sol
        </span>
        <span className="text-xs text-muted-foreground font-mono mt-1">
          {pubkey.toBase58()}
        </span>
      </div>
      <a
        href={`https://solscan.io/account/${pubkey.toBase58()}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary hover:underline"
      >
        View →
      </a>
    </div>
  );
}

function DomainsView() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  
  // Use the SNS React SDK hook to fetch domains
  // The hook returns { data, isLoading, error } structure
  const domains = useDomainsForOwner(connection, publicKey);

  // Debug logging - log domains list to console
  useEffect(() => {
    if (connected && publicKey) {
      console.log('=== SNS Domains Debug ===');
      console.log('Wallet Public Key:', publicKey.toBase58());
      console.log('Loading:', domains.isLoading);
      console.log('Error:', domains.error);
      
      if (domains.data && domains.data.length > 0) {
        console.log('Domains Found:', domains.data.length);
        console.log('Domains List:');
        domains.data.forEach((domainItem: { domain: string; pubkey: PublicKey }, index: number) => {
          console.log(`  ${index + 1}. ${domainItem.domain}.sol (${domainItem.pubkey.toBase58()})`);
        });
      } else if (!domains.isLoading && !domains.error) {
        console.log('No domains found for this wallet');
      }
      console.log('========================');
    }
  }, [connected, publicKey, domains.isLoading, domains.error, domains.data]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4">
        <div className="flex items-center gap-2">
          <Image src="/logo.svg" alt="Lumenless Logo" width={36} height={36} />
          <span className="font-semibold text-lg">Lumenless</span>
        </div>
        <div className="flex items-center gap-3">
          <WalletMultiButton />
        </div>
      </header>

      {/* Main */}
      <main className="px-4 md:px-8 py-8 flex justify-center">
        <Card className="w-full max-w-2xl p-6 border border-border shadow-xl">
          <h2 className="text-2xl font-semibold mb-2">My SNS Domains</h2>
          <p className="text-sm text-muted-foreground mb-4">
            View all your Solana Name Service domains
          </p>

          {!connected && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Connect your wallet to view your domains</p>
            </div>
          )}

          {connected && domains.isLoading && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading domains...</p>
            </div>
          )}

          {connected && domains.error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 mb-4">
              <p className="text-sm text-destructive font-semibold">Failed to fetch domains</p>
              <p className="text-xs text-muted-foreground mt-2">
                {domains.error instanceof Error ? domains.error.message : String(domains.error)}
              </p>
              <div className="mt-3 p-3 bg-muted rounded-md">
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>RPC Error:</strong> The Solana RPC endpoint may be rate-limited or restricted.
                </p>
                <p className="text-xs text-muted-foreground">
                  To fix this, set a custom RPC endpoint in <code className="bg-background px-1 py-0.5 rounded text-xs">.env.local</code>:
                  <br />
                  <code className="bg-background px-1 py-0.5 rounded text-xs block mt-1">
                    NEXT_PUBLIC_SOLANA_RPC_URL=https://your-rpc-endpoint.com
                  </code>
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  You can get a free RPC endpoint from services like Helius, QuickNode, or Alchemy.
                </p>
              </div>
            </div>
          )}

          {connected && !domains.isLoading && domains.data && domains.data.length === 0 && !domains.error && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No domains found</p>
            </div>
          )}

          {connected && !domains.isLoading && domains.data && domains.data.length > 0 && (
            <div className="space-y-3">
              {domains.data.map((domainItem: { domain: string; pubkey: PublicKey }) => (
                <DomainItem 
                  key={domainItem.pubkey.toBase58()} 
                  domain={domainItem.domain}
                  pubkey={domainItem.pubkey}
                />
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

