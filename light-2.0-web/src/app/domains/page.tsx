'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { clusterApiUrl, PublicKey, Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useDomainsForOwner, useDeserializedRecords } from '@bonfida/sns-react';
import { Record, updateRecordV2Instruction, createRecordV2Instruction } from '@bonfida/spl-name-service';
import { WalletButton } from '@/components/WalletButton';

export default function AppPage() {
  // Create a QueryClient instance for React Query
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  // Configure ConnectorKit
  const config = useMemo(() => getDefaultConfig({ appName: 'Lumenless' }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider connectorConfig={config}>
        <DomainsView />
      </AppProvider>
    </QueryClientProvider>
  );
}

interface EditSolRecordModalProps {
  visible: boolean;
  onClose: () => void;
  domain: string;
  currentAddress: string | null;
  onSuccess: () => void;
}

function EditSolRecordModal({ visible, onClose, domain, currentAddress, onSuccess }: EditSolRecordModalProps) {
  // Create connection manually
  const { connection, endpoint } = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    const endpoint = customRpc || clusterApiUrl('mainnet-beta');
    return {
      connection: new Connection(endpoint, 'confirmed'),
      endpoint,
    };
  }, []);

  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const publicKey = useMemo(() => account ? new PublicKey(account.address) : null, [account]);
  
  // Create a signTransaction function compatible with the existing code
  const signTransaction = useMemo(() => {
    if (!signer) return null;
    return async (params: { transaction: Uint8Array }) => {
      const tx = Transaction.from(params.transaction);
      const signed = await signer.signTransaction(tx);
      // Handle different return types
      if (signed instanceof Transaction || signed instanceof VersionedTransaction) {
        return Buffer.from(signed.serialize()).toString('base64');
      }
      // If it's already a Uint8Array or similar
      if (signed instanceof Uint8Array) {
        return Buffer.from(signed).toString('base64');
      }
      throw new Error('Unexpected transaction type from signer');
    };
  }, [signer]);
  const queryClient = useQueryClient();
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successTx, setSuccessTx] = useState<string | null>(null);
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
      setNewAddress(currentAddress || '');
      setError(null);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, currentAddress, onClose]);

  const handleSave = useCallback(async () => {
    if (!publicKey || !newAddress.trim()) {
      setError('Please enter a valid Solana address');
      return;
    }

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(newAddress.trim());
    } catch {
      setError('Invalid Solana address format');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      const transaction = new Transaction();

      // Create or update the record instruction based on whether it exists
      const recordExists = currentAddress && currentAddress.trim() !== '';
      console.log('!!! Current address:', currentAddress);
      console.log('!!! Record exists:', recordExists);
    //   if (!recordExists) {
        console.log('!!! Create record instruction');
        transaction.add(createRecordV2Instruction(
          domain,
          Record.SOL,
          recipientPubkey.toBase58(), // The content is the address as a string
          publicKey, // owner
          publicKey  // payer
        ));
    //   } 

    //   console.log('!!! Update record instruction');
    //   transaction.add(updateRecordV2Instruction(
    //     domain,
    //     Record.SOL,
    //     recipientPubkey.toBase58(), // The content is the address as a string
    //     publicKey, // owner
    //     publicKey  // payer
    //   ));

      
      // Create and send transaction
      transaction.feePayer = publicKey;

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;

      // Sign transaction using ConnectorKit
      if (!signTransaction) {
        throw new Error('Wallet does not support signing transactions');
      }

      const signedTransaction = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      // Send the signed transaction
      const signature = await connection.sendRawTransaction(
        Buffer.from(signedTransaction, 'base64'),
        { skipPreflight: false }
      );
      
      // Wait for confirmation
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      setSuccessTx(signature);

      // Invalidate the query to refetch the record
      queryClient.invalidateQueries({ queryKey: ['useDeserializedRecords', endpoint, domain, [Record.SOL]] });

      // Wait a bit before closing to show success
      setTimeout(() => {
        onSuccess();
        onClose();
        setNewAddress('');
        setSuccessTx(null);
      }, 1500);
    } catch (err: unknown) {
      console.error('Error updating SOL record:', err);
      setError(err instanceof Error ? err.message : 'Failed to update record. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [publicKey, newAddress, domain, currentAddress, connection, endpoint, signTransaction, queryClient, onSuccess, onClose]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card ref={modalRef} className="w-full max-w-md p-6 bg-white shadow-xl">
          <h3 className="text-lg font-semibold mb-4">Edit Fund Receiving Address</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Update the SOL receiving address for <strong>{domain}.sol</strong>
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">New Solana Address</label>
              <Input
                type="text"
                placeholder="Enter Solana wallet address"
                value={newAddress}
                onChange={(e) => {
                  setError(null);
                  setNewAddress(e.target.value);
                }}
                className={error ? 'border-destructive' : ''}
                disabled={isProcessing}
              />
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
              {successTx && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                  <p className="text-green-800 font-medium">✓ Record updated successfully!</p>
                  <a
                    href={`https://solscan.io/tx/${successTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-600 hover:underline mt-1 inline-block"
                  >
                    View transaction →
                  </a>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isProcessing || !newAddress.trim()}
              >
                {isProcessing ? 'Processing...' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function DomainItem({ domain, pubkey }: { domain: string; pubkey: PublicKey }) {
  // Create connection manually
  const connection = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    const endpoint = customRpc || clusterApiUrl('mainnet-beta');
    return new Connection(endpoint, 'confirmed');
  }, []);
  const [editModalVisible, setEditModalVisible] = useState(false);
  
  // Fetch the SOL record (fund receiving address) for this domain
  const solRecord = useDeserializedRecords(
    connection,
    domain,
    [Record.SOL] // Record.SOL contains the fund receiving address
  );
  console.log('!!!', 'domain:', domain, 'SOL record:', solRecord.data);

  const handleEditSuccess = useCallback(() => {
    // The query will be invalidated by the modal, but we can also refetch here
    solRecord.refetch();
  }, [solRecord]);

  return (
    <>
      <div className="rounded-lg border border-border bg-card/50 p-4 hover:bg-card/80 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="flex flex-col flex-1">
            <span className="font-medium text-lg">
              {domain}.sol
            </span>
            <span className="text-xs text-muted-foreground font-mono mt-1">
              Domain: {pubkey.toBase58()}
            </span>
          </div>
          <a
            href={`https://solscan.io/account/${pubkey.toBase58()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline ml-4"
          >
            View →
          </a>
        </div>
        
        {/* Records Section */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Fund Receiving Address (SOL):</span>
              <div className="flex items-center gap-2">
                {solRecord.isLoading && (
                  <span className="text-xs text-muted-foreground">Loading...</span>
                )}
                {solRecord.error && (
                  <span className="text-xs text-destructive">Error loading</span>
                )}
                {!solRecord.isLoading && !solRecord.error && solRecord.data && solRecord.data[0] && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground">
                      {solRecord.data[0]}
                    </span>
                    <a
                      href={`https://solscan.io/account/${solRecord.data[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      ↗
                    </a>
                  </div>
                )}
                {!solRecord.isLoading && !solRecord.error && (!solRecord.data || !solRecord.data[0]) && (
                  <span className="text-xs text-muted-foreground italic">Not set</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditModalVisible(true)}
                  className="text-xs h-7 px-2"
                >
                  Edit
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <EditSolRecordModal
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        domain={domain}
        currentAddress={solRecord.data?.[0] || null}
        onSuccess={handleEditSuccess}
      />
    </>
  );
}

function DomainsView() {
  // Create connection manually
  const connection = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    const endpoint = customRpc || clusterApiUrl('mainnet-beta');
    return new Connection(endpoint, 'confirmed');
  }, []);

  const { connected } = useConnector();
  const { account } = useAccount();
  const publicKey = useMemo(() => account ? new PublicKey(account.address) : null, [account]);
  
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
          console.log(`  ${index + 1}. ${domainItem.domain}.sol`);
          console.log(`     Domain Account: ${domainItem.pubkey.toBase58()}`);
        });
        console.log('Note: Fund receiving addresses (SOL records) are loaded per domain below.');
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
          <WalletButton />
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

