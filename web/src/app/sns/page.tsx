'use client';

// ============================================
// FEATURE FLAG: SNS Route Enabled
// Set to true to enable the /sns route
// Set to false to disable (returns 404)
// ============================================
const SNS_ROUTE_ENABLED = process.env.NEXT_PUBLIC_SNS_ROUTE_ENABLED === 'true';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { createSolanaRpc, address, type Instruction, type Base64EncodedWireTransaction } from '@solana/kit';
import { PublicKey, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js'; // Temporary - for Keypair and transaction building until kit has full support
import type { Record as SnsRecord } from '@solana-name-service/sns-sdk-kit';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@solana/connector/react';
import { getDefaultConfig } from '@solana/connector/headless';
import { useConnector, useAccount, useTransactionSigner } from '@solana/connector';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
// Import all SNS functionality from our service (migrated to kit)
import { 
  useDomainRecord, 
  useWrappedDomains, 
  useDomainsForOwner,
  useSubdomainsForOwner,
  useSecuredDomains,
  useVaultBalance,
  SNSService,
} from '@/lib/sns-service';
import { register } from '@bonfida/sub-register';
import { transferSubdomain } from '@bonfida/spl-name-service';

// Import instructions and bindings from @solana-name-service/sns-sdk-kit
import {
  updateRecord,
  createRecord,
  validateRoa,
  writeRoa,
  Record,
} from '@solana-name-service/sns-sdk-kit';
import { TransactionInstruction, Connection } from '@solana/web3.js';

// Note: @bonfida/spl-name-service doesn't provide a wrapName function.
// Wrapping domains to NFTs requires using the Metaplex Token Metadata program
// and transferring domain ownership to the NFT mint. This is a complex operation
// that isn't directly supported by this package.

// Helper to convert PublicKey to Address
function publicKeyToAddress(pubkey: PublicKey): ReturnType<typeof address> {
  return address(pubkey.toBase58());
}

// Helper to convert Instruction to TransactionInstruction
function iInstructionToTransactionInstruction(iInstruction: Instruction): TransactionInstruction {
  // Instruction from @solana/kit has programAddress, accounts, and data
  return new TransactionInstruction({
    programId: new PublicKey(iInstruction.programAddress),
    keys: (iInstruction.accounts || []).map((acc: { address: string; isSigner?: boolean; isWritable?: boolean }) => ({
      pubkey: new PublicKey(acc.address),
      isSigner: acc.isSigner || false,
      isWritable: acc.isWritable || false,
    })),
    data: Buffer.from(iInstruction.data || []),
  });
}

// Create wrapper functions for compatibility with old API
const updateRecordV2Instruction = async (
  domain: string,
  record: SnsRecord,
  content: string,
  owner: PublicKey,
  payer: PublicKey
): Promise<TransactionInstruction> => {
  const instruction = await updateRecord({
    domain,
    record,
    content,
    owner: publicKeyToAddress(owner),
    payer: publicKeyToAddress(payer),
  });
  return iInstructionToTransactionInstruction(instruction);
};

const createRecordV2Instruction = async (
  domain: string,
  record: SnsRecord,
  content: string,
  owner: PublicKey,
  payer: PublicKey
): Promise<TransactionInstruction> => {
  const instruction = await createRecord({
    domain,
    record,
    content,
    owner: publicKeyToAddress(owner),
    payer: publicKeyToAddress(payer),
  });
  return iInstructionToTransactionInstruction(instruction);
};

const validateRecordV2Content = async (
  staleness: boolean,
  domain: string,
  record: SnsRecord,
  owner: PublicKey,
  payer: PublicKey,
  verifier?: PublicKey
): Promise<TransactionInstruction> => {
  const instruction = await validateRoa({
    staleness,
    domain,
    record,
    owner: publicKeyToAddress(owner),
    payer: publicKeyToAddress(payer),
    verifier: verifier ? publicKeyToAddress(verifier) : publicKeyToAddress(owner),
  });
  return iInstructionToTransactionInstruction(instruction);
};

const writRoaRecordV2 = async (
  domain: string,
  record: SnsRecord,
  roaId: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): Promise<TransactionInstruction> => {
  const instruction = await writeRoa({
    domain,
    record,
    roaId: publicKeyToAddress(roaId),
    owner: publicKeyToAddress(owner),
    payer: publicKeyToAddress(payer),
  });
  return iInstructionToTransactionInstruction(instruction);
};
import { WalletButton } from '@/components/WalletButton';
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  isDomainSecured,
  buildDepositTransaction,
  buildWithdrawTransaction,
  buildDepositUnwrappedTransaction,
  buildWithdrawUnwrappedTransaction,
  buildDepositWithRecordTransaction,
} from '@/lib/vault-service';

export default function AppPage() {
  // Check if the SNS route is enabled
  if (!SNS_ROUTE_ENABLED) {
    notFound();
  }

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
  // Create RPC endpoint
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account ? account.address : null, [account]);
  // Keep publicKey for transaction building (instructions need PublicKey)
  const publicKey = useMemo(() => ownerAddress ? new PublicKey(ownerAddress) : null, [ownerAddress]);
  
  // Initialize test keypair from environment variable (base58)
  const testKeypair = useMemo(() => {
    const testPrivateKey = process.env.NEXT_PUBLIC_TEST_PRIVATE_KEY;
    if (!testPrivateKey) {
      console.warn('NEXT_PUBLIC_TEST_PRIVATE_KEY not set; validation will fail');
      return null;
    }
    try {
      return Keypair.fromSecretKey(bs58.decode(testPrivateKey));
    } catch (err) {
      console.error('Failed to initialize test keypair:', err);
      return null;
    }
  }, []);
  
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

      // Determine if record already exists
      const recordExists = currentAddress && currentAddress.trim() !== '';
      console.log('!!! Record exists:', recordExists);
      console.log('!!! Current address:', currentAddress);
      
      if (recordExists) {
        // Update existing record - following SNS dashboard pattern
        console.log('!!! Updating existing record');
        
        // Instruction 1: Edit record (updateRecordV2Instruction)
        const updateRecordIx = await updateRecordV2Instruction(
          domain,
          Record.SOL,
          recipientPubkey.toBase58(), // The content is the address as a string
          publicKey, // owner
          publicKey  // payer
        );
        transaction.add(updateRecordIx);
        
        // Instruction 2: Validate Solana signature (validateRecordV2Content)
        // This validates staleness - must come before Write RoA
        const validateRecordIx = await validateRecordV2Content(
          true, // staleness - true when updating existing record
          domain,
          Record.SOL,
          publicKey, // owner
          publicKey, // payer
          testKeypair ? testKeypair.publicKey : publicKey  // verifier - prefer test keypair
        );
        transaction.add(validateRecordIx);
        
        // Instruction 3: Write RoA (writRoaRecordV2)
        // This must come AFTER validateRecordV2Content, and the roaId should be the content (recipient address)
        // The ROA links the record content to the verifier for verification
        const writRoaIx = await writRoaRecordV2(
          domain,
          Record.SOL,
          recipientPubkey, // roaId - must be the recipient address (content of the record)
          publicKey, // owner
          publicKey  // payer
        );
        transaction.add(writRoaIx);
      } else {
        // Create new record
        console.log('!!! Creating new record');
        const createRecordIx = await createRecordV2Instruction(
          domain,
          Record.SOL,
          recipientPubkey.toBase58(), // The content is the address as a string
          publicKey, // owner
          publicKey  // payer
        );
        transaction.add(createRecordIx);
        
        //TODO: uncomment
        // // Validate the new record
        // const validateRecordIx = validateRecordV2Content(
        //   true, // staleness - false for new records
        //   domain,
        //   Record.SOL,
        //   publicKey, // owner
        //   publicKey, // payer
        //   recipientPubkey  // verifier (same as owner)
        // );
        // transaction.add(validateRecordIx);
      }

      
      // Create and send transaction
      transaction.feePayer = publicKey;

      // Create RPC for transaction operations
      const rpc = createSolanaRpc(endpoint);
      const { value: { blockhash } } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      transaction.recentBlockhash = blockhash;

      // Both signatures required: testKeypair (verifier) + user wallet
      if (!signTransaction) {
        throw new Error('Wallet does not support signing transactions');
      }
      if (!testKeypair) {
        throw new Error('Test keypair not found; set NEXT_PUBLIC_TEST_PRIVATE_KEY');
      }

      // First: sign with test keypair
      transaction.partialSign(testKeypair);

      // Then: have the user wallet sign
      const userSignedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      console.log('!!! User signed transaction');
      
      // Deserialize, ensure both signatures present
      const fullySignedTx = Transaction.from(Buffer.from(userSignedTx, 'base64'));
      const hasTestSig = fullySignedTx.signatures.some(sig => sig.publicKey.equals(testKeypair.publicKey) && sig.signature);
      if (!hasTestSig) {
        console.log('!!! Re-adding test keypair signature');
        fullySignedTx.partialSign(testKeypair);
      }
      const hasUserSig = fullySignedTx.signatures.some(sig => sig.publicKey.equals(publicKey) && sig.signature);
      if (!hasUserSig) {
        throw new Error('User signature missing from transaction');
      }

      const finalSignedTx = fullySignedTx.serialize();
      
      // Send the signed transaction (convert Buffer to base64 string for kit)
      const txBase64 = finalSignedTx.toString('base64');
      const signatureResponse = await rpc.sendTransaction(txBase64 as Base64EncodedWireTransaction, { skipPreflight: false }).send();
      const sig = signatureResponse;
      
      // Wait for confirmation using getSignatureStatuses (kit doesn't have confirmTransaction)
      let confirmed = false;
      let attempts = 0;
      while (!confirmed && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const statusResponse = await rpc.getSignatureStatuses([sig], { searchTransactionHistory: true }).send();
        const status = statusResponse.value[0];
        if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
          confirmed = true;
        }
        attempts++;
      }

      setSuccessTx(sig);

      // Invalidate the query to refetch the record
      queryClient.invalidateQueries({ queryKey: ['sns-record', endpoint, domain, Record.SOL] });

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
  }, [publicKey, newAddress, domain, currentAddress, endpoint, signTransaction, testKeypair, queryClient, onSuccess, onClose]);

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

function DomainItem({ domain, pubkey, isWrapped, isSubdomain, parentDomain, mintAddress, isSecuredProp, onWrapSuccess }: { 
  domain: string; 
  pubkey: string | ReturnType<typeof address>; 
  isWrapped: boolean; 
  isSubdomain?: boolean;
  parentDomain?: string;
  mintAddress?: string; // NFT mint address for wrapped domains
  isSecuredProp?: boolean; // Whether this domain is already known to be secured
  onWrapSuccess?: () => void;
}) {
  // Create RPC endpoint
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isWrapping, setIsWrapping] = useState(false);
  const [isSecuring, setIsSecuring] = useState(false);
  const [isUnsecuring, setIsUnsecuring] = useState(false);
  // Initialize with the prop value if provided (from vault fetch)
  const [isSecured, setIsSecured] = useState<boolean | null>(isSecuredProp ?? null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  
  // Update isSecured when prop changes (e.g., after vault data loads)
  useEffect(() => {
    if (isSecuredProp !== undefined) {
      setIsSecured(isSecuredProp);
    }
  }, [isSecuredProp]);
  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const queryClient = useQueryClient();
  
  // Full domain name for display and record queries
  const fullDomain = isSubdomain && parentDomain ? `${domain}.${parentDomain}` : domain;
  
  // Use the SNS service to fetch both V1 and V2 records
  // Type assertion needed due to enum type mismatch between packages
  const solRecordQuery = useDomainRecord(endpoint, fullDomain, Record.SOL as unknown as typeof Record);
  
  // Extract data from the query result
  const solAddress = solRecordQuery.data?.address || null;
  const isVerified = solRecordQuery.data?.isVerified ?? null;
  const isLoading = solRecordQuery.isLoading;
  const error = solRecordQuery.error;
  const source = solRecordQuery.data?.source || null;
  
  // Debug logging for lumenless domain
  useEffect(() => {
    if (domain === 'lumenless') {
      console.log('=== LUMENLESS DOMAIN DEBUG ===');
      console.log('Domain:', domain);
      console.log('SOL Record Query:', {
        data: solRecordQuery.data,
        isLoading: solRecordQuery.isLoading,
        error: solRecordQuery.error,
        address: solAddress,
        isVerified,
        source,
      });
      console.log('=============================');
    }
  }, [domain, solRecordQuery, solAddress, isVerified, source]);

  const handleEditSuccess = useCallback(() => {
    // Invalidate the query to refetch
    solRecordQuery.refetch();
  }, [solRecordQuery]);

  // Check if this domain is secured in the vault
  useEffect(() => {
    // If we already have the secured status from props, don't override it
    if (isSecuredProp !== undefined) {
      return;
    }
    
    // Not a wrapped domain or no mint address - can't be secured yet
    if (!isWrapped || !mintAddress) {
      setIsSecured(false); // Not secured (needs to be wrapped first)
      return;
    }
    
    // No wallet connected - can't check, but default to false (not secured)
    if (!account?.address) {
      setIsSecured(false);
      return;
    }
    
    const checkSecured = async () => {
      try {
        const connection = new Connection(endpoint, 'confirmed');
        const ownerPubkey = new PublicKey(account.address);
        const mintPubkey = new PublicKey(mintAddress);
        const secured = await isDomainSecured(connection, ownerPubkey, mintPubkey);
        setIsSecured(secured);
      } catch (err) {
        console.error('Error checking domain security status:', err);
        // If check fails (e.g., program not deployed), default to not secured
        setIsSecured(false);
      }
    };
    
    checkSecured();
  }, [isWrapped, mintAddress, account?.address, endpoint, isSecuredProp]);

  // Create a signTransaction function
  const signTransaction = useMemo(() => {
    if (!signer) return null;
    return async (params: { transaction: Uint8Array }) => {
      const tx = Transaction.from(params.transaction);
      const signed = await signer.signTransaction(tx);
      if (signed instanceof Transaction || signed instanceof VersionedTransaction) {
        return Buffer.from(signed.serialize()).toString('base64');
      }
      if (signed instanceof Uint8Array) {
        return Buffer.from(signed).toString('base64');
      }
      throw new Error('Unexpected transaction type from signer');
    };
  }, [signer]);

  // Handle securing a domain (deposit to vault)
  const handleSecureDomain = useCallback(async () => {
    if (!account?.address || !signTransaction) {
      setSecurityError('Wallet not connected');
      return;
    }
    
    try {
      setIsSecuring(true);
      setSecurityError(null);
      
      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(account.address);
      
      let transaction: Transaction;
      
      if (isWrapped && mintAddress) {
        // For wrapped (NFT) domains, use the NFT deposit
        const mintPubkey = new PublicKey(mintAddress);
        transaction = await buildDepositTransaction(connection, ownerPubkey, mintPubkey);
      } else {
        // For unwrapped domains, use deposit with SOL record update
        // This automatically sets the SOL record to point to the vault PDA
        const nameAccountPubkey = new PublicKey(pubkey);
        transaction = await buildDepositWithRecordTransaction(connection, ownerPubkey, nameAccountPubkey);
      }
      
      transaction.feePayer = ownerPubkey;
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      
      // Sign and send
      const signedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      const sig = await connection.sendRawTransaction(Buffer.from(signedTx, 'base64'), {
        skipPreflight: false,
      });
      
      await connection.confirmTransaction(sig, 'confirmed');
      
      console.log('Domain secured successfully:', sig);
      
      // Cache the domain name for later resolution
      // This helps when the secured domains query can't resolve the name
      const pubkeyStr = typeof pubkey === 'string' ? pubkey : String(pubkey);
      localStorage.setItem(`secured-domain-${pubkeyStr}`, domain);
      console.log(`[Secure] Cached domain name: ${domain} for ${pubkeyStr}`);
      
      // Wait a moment for the blockchain state to propagate before refetching
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh all domain queries - don't manually set state, let the refetch update it
      await queryClient.invalidateQueries({ queryKey: ['wrapped-domains'] });
      await queryClient.invalidateQueries({ queryKey: ['secured-domains'] });
      await queryClient.invalidateQueries({ queryKey: ['domains-for-owner'] });
      await queryClient.invalidateQueries({ queryKey: ['subdomains-for-owner'] });
    } catch (err) {
      console.error('Error securing domain:', err);
      setSecurityError(err instanceof Error ? err.message : 'Failed to secure domain');
    } finally {
      setIsSecuring(false);
    }
  }, [account?.address, mintAddress, isWrapped, pubkey, signTransaction, endpoint, queryClient]);

  // Handle unsecuring a domain (withdraw from vault)
  const handleUnsecureDomain = useCallback(async () => {
    if (!account?.address || !signTransaction) {
      setSecurityError('Wallet not connected');
      return;
    }
    
    try {
      setIsUnsecuring(true);
      setSecurityError(null);
      
      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(account.address);
      
      let transaction: Transaction;
      
      if (isWrapped && mintAddress) {
        // For wrapped (NFT) domains, use the NFT withdraw
        const mintPubkey = new PublicKey(mintAddress);
        transaction = await buildWithdrawTransaction(ownerPubkey, mintPubkey);
      } else {
        // For unwrapped domains, use the name account withdraw
        const nameAccountPubkey = new PublicKey(pubkey);
        transaction = buildWithdrawUnwrappedTransaction(ownerPubkey, nameAccountPubkey);
      }
      
      transaction.feePayer = ownerPubkey;
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      
      // Sign and send
      const signedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      const sig = await connection.sendRawTransaction(Buffer.from(signedTx, 'base64'), {
        skipPreflight: false,
      });
      
      await connection.confirmTransaction(sig, 'confirmed');
      
      console.log('Domain unsecured successfully:', sig);
      
      // Clear the cached domain name
      const pubkeyStr = typeof pubkey === 'string' ? pubkey : String(pubkey);
      localStorage.removeItem(`secured-domain-${pubkeyStr}`);
      console.log(`[Unsecure] Cleared cached domain name for ${pubkeyStr}`);
      
      // Wait a moment for the blockchain state to propagate before refetching
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh all domain queries - don't manually set state, let the refetch update it
      await queryClient.invalidateQueries({ queryKey: ['wrapped-domains'] });
      await queryClient.invalidateQueries({ queryKey: ['secured-domains'] });
      await queryClient.invalidateQueries({ queryKey: ['domains-for-owner'] });
      await queryClient.invalidateQueries({ queryKey: ['subdomains-for-owner'] });
    } catch (err) {
      console.error('Error unsecuring domain:', err);
      setSecurityError(err instanceof Error ? err.message : 'Failed to unsecure domain');
    } finally {
      setIsUnsecuring(false);
    }
  }, [account?.address, mintAddress, isWrapped, pubkey, signTransaction, endpoint, queryClient]);

  const handleWrap = useCallback(async () => {
    // TODO: Implement domain wrapping functionality
    // Wrapping a domain to NFT requires:
    // 1. Creating an NFT mint and metadata using Metaplex
    // 2. Transferring domain ownership to the NFT mint
    // 3. Setting up the NFT metadata to link to the domain
    // This is a complex operation that requires multiple instructions
    alert('Domain wrapping functionality is not yet implemented. This requires integrating with Metaplex Token Metadata program.');
  }, []);

  return (
    <>
      <div className="rounded-lg border border-border bg-card/50 p-4 hover:bg-card/80 transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="flex flex-col flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-lg">
                {isSubdomain && parentDomain ? `${domain}.${parentDomain}.sol` : `${domain}.sol`}
              </span>
               {isSubdomain ? (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium" title="This is a subdomain">
                  Subdomain
                </span>
              ) : isWrapped ? (
                <>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium" title="This domain is wrapped into an NFT">
                    NFT
                  </span>
                  {isSecured === true && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium" title="This domain is secured in your vault">
                      🔒 Secured
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium" title="This domain is not wrapped">
                  Unwrapped
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono mt-1">
              Domain: {typeof pubkey === 'string' ? pubkey : pubkey}
            </span>
            {securityError && (
              <span className="text-xs text-red-600 mt-1">
                {securityError}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Secure/Unsecure buttons for all domains */}
            {isSecured === true ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnsecureDomain}
                disabled={isUnsecuring}
                className="text-xs h-7 px-2 border-orange-500 text-orange-600 hover:bg-orange-50"
              >
                {isUnsecuring ? 'Unsecuring...' : '🔓 Unsecure'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="default"
                onClick={handleSecureDomain}
                disabled={isSecuring}
                className="text-xs h-7 px-2 bg-green-600 hover:bg-green-700"
              >
                {isSecuring ? 'Securing...' : '🔒 Secure'}
              </Button>
            )}
            {!isWrapped && !isSubdomain && (
              <Button
                size="sm"
                variant="default"
                onClick={handleWrap}
                disabled={isWrapping}
                className="text-xs h-7 px-2"
              >
                {isWrapping ? 'Wrapping...' : 'Wrap to NFT'}
              </Button>
            )}
            <a
              href={`https://solscan.io/account/${typeof pubkey === 'string' ? pubkey : pubkey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View →
            </a>
          </div>
        </div>
        
        {/* Records Section */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Fund Receiving Address (SOL):</span>
              <div className="flex items-center gap-2">
                {isLoading && (
                  <span className="text-xs text-muted-foreground">Loading...</span>
                )}
                {error && (
                  <span className="text-xs text-destructive">Error loading</span>
                )}
                {!isLoading && !error && solAddress && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground">
                      {solAddress}
                    </span>
                    {source && (
                      <span className="text-xs text-muted-foreground" title={`Record source: ${source}`}>
                        ({source})
                      </span>
                    )}
                    {isVerified === true ? (
                      <span className="text-xs text-green-600 font-medium" title="Verified address">✓ Verified</span>
                    ) : isVerified === false ? (
                      <span className="text-xs text-yellow-600 font-medium" title="Unverified address">⚠ Unverified</span>
                    ) : null}
                    <a
                      href={`https://solscan.io/account/${solAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      ↗
                    </a>
                  </div>
                )}
                {!isLoading && !error && !solAddress && (
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
              currentAddress={solAddress}
              onSuccess={handleEditSuccess}
            />
    </>
  );
}

interface CreateSubdomainModalProps {
  visible: boolean;
  onClose: () => void;
  parentDomain: string;
  onSuccess: () => void;
}

function CreateSubdomainModal({ visible, onClose, parentDomain, onSuccess }: CreateSubdomainModalProps) {
  // Create RPC endpoint
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  const { account } = useAccount();
  const { signer } = useTransactionSigner();
  const ownerAddress = useMemo(() => account ? account.address : null, [account]);
  const publicKey = useMemo(() => ownerAddress ? new PublicKey(ownerAddress) : null, [ownerAddress]);
  
  const queryClient = useQueryClient();
  const [subdomainName, setSubdomainName] = useState('');
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
      setSubdomainName('');
      setError(null);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onClose]);

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

  const handleCreate = useCallback(async () => {
    if (!publicKey || !subdomainName.trim()) {
      setError('Please enter a valid subdomain name');
      return;
    }

    // Validate subdomain name (basic validation)
    const trimmedName = subdomainName.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(trimmedName)) {
      setError('Subdomain name can only contain lowercase letters, numbers, and hyphens');
      return;
    }

    if (trimmedName.length < 1 || trimmedName.length > 63) {
      setError('Subdomain name must be between 1 and 63 characters');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      // Create Connection from endpoint
      const connection = new Connection(endpoint, 'confirmed');
      
      // Check if subdomain is available before attempting to register
      const snsService = new SNSService(endpoint);
      const { available, existingOwner } = await snsService.isSubdomainAvailable(trimmedName, parentDomain, endpoint);
      
      if (!available) {
        const ownerStr = existingOwner ? existingOwner.toBase58() : 'unknown';
        throw new Error(`Subdomain "${trimmedName}.${parentDomain}.sol" is already registered (owner: ${ownerStr==publicKey.toString() ? 'You' : `${ownerStr.slice(0, 4)}...${ownerStr.slice(-4)}`})`);
      }
      
      const parentDomainOwner = new PublicKey('FxKaUzVReCUDj3j46M73PeYpJYkkUmTzkUjh6uZ3Rgag'); // current owner of the lumenless.sol registrar
            
      // Normal case: parent domain is owned by a wallet, create subdomain directly
      const fullSubdomain = `${trimmedName}.${parentDomain}.sol`;
      console.log('Full subdomain:', fullSubdomain);
      console.log('Parent domain owner:', parentDomainOwner.toBase58());

      const createSubdomainInstructions = await register(
        connection,
        parentDomainOwner,
        publicKey,
        PublicKey.default,
        trimmedName,
      );

      const transaction = new Transaction();
      transaction.add(...createSubdomainInstructions);
      transaction.feePayer = publicKey;

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;

      // Sign and send transaction
      if (!signTransaction) {
        throw new Error('Wallet does not support signing transactions');
      }

      // Have the user wallet sign
      const userSignedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      const rawTx = Buffer.from(userSignedTx, 'base64');
      
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        maxRetries: 0,
      });
      
      // Wait for confirmation using Connection
      await connection.confirmTransaction(sig, 'confirmed');

      setSuccessTx(sig);

      // Invalidate queries to refetch domains
      queryClient.invalidateQueries({ queryKey: ['domains-for-owner'] });
      queryClient.invalidateQueries({ queryKey: ['wrapped-domains'] });

      // Wait a bit before closing to show success
      setTimeout(() => {
        onSuccess();
        onClose();
        setSubdomainName('');
        setSuccessTx(null);
      }, 1500);
    } catch (err: unknown) {
      console.error('Error creating subdomain:', err);
      setError(err instanceof Error ? err.message : 'Failed to create subdomain. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [publicKey, subdomainName, parentDomain, endpoint, signTransaction, queryClient, onSuccess, onClose]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card ref={modalRef} className="w-full max-w-md p-6 bg-white shadow-xl">
          <h3 className="text-lg font-semibold mb-4">Create Subdomain</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create a new subdomain under <strong>{parentDomain}.sol</strong>
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Subdomain Name</label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="e.g., mike"
                  value={subdomainName}
                  onChange={(e) => {
                    setError(null);
                    setSubdomainName(e.target.value.toLowerCase());
                  }}
                  className={error ? 'border-destructive' : ''}
                  disabled={isProcessing}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  .{parentDomain}.sol
                </span>
              </div>
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
              {successTx && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                  <p className="text-green-800 font-medium">✓ Subdomain created successfully!</p>
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
              <p className="text-xs text-muted-foreground mt-2">
                The subdomain will be: <strong>{subdomainName.trim() || '...'}.{parentDomain}.sol</strong>
              </p>
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
                onClick={handleCreate}
                disabled={isProcessing || !subdomainName.trim()}
              >
                {isProcessing ? 'Creating...' : 'Create Subdomain'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

// Token icon component with fallback placeholder
function TokenIcon({ logoUri, symbol, size = 32 }: { logoUri?: string; symbol?: string; size?: number }) {
  const [imgError, setImgError] = useState(false);
  
  const firstLetter = symbol?.[0]?.toUpperCase() || '?';
  
  // Show placeholder if no logo URI or if image failed to load
  if (!logoUri || imgError) {
    return (
      <div 
        className="rounded-full bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center font-bold text-gray-600 shadow-inner"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {firstLetter}
      </div>
    );
  }
  
  return (
    <img
      src={logoUri}
      alt={symbol || 'Token'}
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}

// Default tokens to initialize vault with
const DEFAULT_VAULT_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'WSOL', name: 'Wrapped SOL', decimals: 9, logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoUri: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg' },
  { mint: '6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM', symbol: 'LUMEN', name: 'Lumen', decimals: 9, logoUri: undefined },
  { mint: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', symbol: 'USD1', name: 'USD1 Stablecoin', decimals: 6, logoUri: undefined },
];

function VaultBalanceCard({ endpoint, ownerAddress }: { endpoint: string; ownerAddress: string | null }) {
  const vaultBalance = useVaultBalance(endpoint, ownerAddress, { enabled: !!ownerAddress });
  const { signer } = useTransactionSigner();
  const queryClient = useQueryClient();
  const [isInitializing, setIsInitializing] = useState(false);
  const [isCreatingAta, setIsCreatingAta] = useState(false);
  const [ataError, setAtaError] = useState<string | null>(null);
  const [ataSuccess, setAtaSuccess] = useState<string | null>(null);
  const [showAddTokenModal, setShowAddTokenModal] = useState(false);
  const [customMint, setCustomMint] = useState('');
  
  // Format large numbers with commas
  const formatNumber = (num: number) => {
    if (num < 0.0001 && num > 0) {
      return num.toExponential(4);
    }
    return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
  };
  
  // Truncate address for display
  const truncateAddress = (addr: string) => `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  // Create a signTransaction function
  const signTransaction = useMemo(() => {
    if (!signer) return null;
    return async (params: { transaction: Uint8Array }) => {
      const tx = Transaction.from(params.transaction);
      const signed = await signer.signTransaction(tx);
      if (signed instanceof Transaction || signed instanceof VersionedTransaction) {
        return Buffer.from(signed.serialize()).toString('base64');
      }
      if (signed instanceof Uint8Array) {
        return Buffer.from(signed).toString('base64');
      }
      throw new Error('Unexpected transaction type from signer');
    };
  }, [signer]);

  // Initialize vault with all default token ATAs through smart contract
  const handleInitVault = useCallback(async () => {
    if (!ownerAddress || !signTransaction) {
      setAtaError('Wallet not connected');
      return;
    }

    try {
      setIsInitializing(true);
      setAtaError(null);
      setAtaSuccess(null);

      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(ownerAddress);
      
      // Import vault service function
      const { buildInitVaultWithTokensTransaction } = await import('@/lib/vault-service');
      
      // Convert token mint strings to PublicKeys
      const tokenMints = DEFAULT_VAULT_TOKENS.map(t => new PublicKey(t.mint));
      
      // Build transaction through smart contract
      const transaction = await buildInitVaultWithTokensTransaction(
        connection,
        ownerPubkey,
        tokenMints
      );
      
      if (transaction.instructions.length === 0) {
        setAtaSuccess('Vault already initialized with all default tokens!');
        return;
      }
      
      // Count how many tokens will be initialized
      const tokensToCreate = DEFAULT_VAULT_TOKENS
        .filter((_, i) => transaction.instructions.some(ix => 
          ix.keys.some(k => k.pubkey.equals(tokenMints[i]))
        ))
        .map(t => t.symbol);
      
      transaction.feePayer = ownerPubkey;
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      
      // Sign and send
      const signedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      const sig = await connection.sendRawTransaction(Buffer.from(signedTx, 'base64'), {
        skipPreflight: false,
      });
      
      await connection.confirmTransaction(sig, 'confirmed');
      
      console.log(`Initialized vault through smart contract:`, sig);
      setAtaSuccess(`Vault initialized! TX: ${sig.slice(0, 8)}...`);
      
      // Refresh balance
      queryClient.invalidateQueries({ queryKey: ['vault-balance'] });
    } catch (err) {
      console.error('Error initializing vault:', err);
      setAtaError(err instanceof Error ? err.message : 'Failed to initialize vault');
    } finally {
      setIsInitializing(false);
    }
  }, [ownerAddress, endpoint, signTransaction, queryClient]);

  // Create ATA for a custom token mint through smart contract
  const handleCreateCustomAta = useCallback(async () => {
    if (!ownerAddress || !signTransaction || !customMint.trim()) {
      setAtaError('Please enter a valid token mint address');
      return;
    }

    // Validate mint address
    let mintPubkey: PublicKey;
    try {
      mintPubkey = new PublicKey(customMint.trim());
    } catch {
      setAtaError('Invalid mint address format');
      return;
    }

    try {
      setIsCreatingAta(true);
      setAtaError(null);
      setAtaSuccess(null);

      const connection = new Connection(endpoint, 'confirmed');
      const ownerPubkey = new PublicKey(ownerAddress);
      
      // Verify mint exists
      const mintInfo = await connection.getAccountInfo(mintPubkey);
      if (!mintInfo) {
        setAtaError('Token mint not found on chain');
        return;
      }
      
      // Import vault service functions
      const { getVaultPDA, createInitVaultTokenAccountInstruction, vaultExists, createInitializeVaultInstruction, getTokenProgramForMint } = await import('@/lib/vault-service');
      const { getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
      
      const [vaultPDA] = getVaultPDA(ownerPubkey);
      
      // Detect which token program this mint belongs to (Token vs Token-2022)
      const tokenProgramId = await getTokenProgramForMint(connection, mintPubkey);
      console.log(`Token ${mintPubkey.toBase58()} uses ${tokenProgramId.toBase58() === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? 'Token-2022' : 'Token'} program`);
      
      // Get the ATA address for the vault using the correct token program
      const vaultAta = getAssociatedTokenAddressSync(
        mintPubkey,
        vaultPDA,
        true, // allowOwnerOffCurve - REQUIRED for PDAs!
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Check if ATA already exists
      const ataInfo = await connection.getAccountInfo(vaultAta);
      if (ataInfo) {
        setAtaSuccess('Token account already exists!');
        setShowAddTokenModal(false);
        setCustomMint('');
        return;
      }
      
      const transaction = new Transaction();
      
      // Check if vault exists, if not initialize it first
      const hasVault = await vaultExists(connection, ownerPubkey);
      if (!hasVault) {
        transaction.add(createInitializeVaultInstruction(ownerPubkey));
      }
      
      // Create ATA through smart contract with correct token program
      const initAtaIx = createInitVaultTokenAccountInstruction(ownerPubkey, mintPubkey, tokenProgramId);
      transaction.add(initAtaIx);
      
      transaction.feePayer = ownerPubkey;
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      
      // Sign and send
      const signedTx = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false }),
      });
      
      const sig = await connection.sendRawTransaction(Buffer.from(signedTx, 'base64'), {
        skipPreflight: false,
      });
      
      await connection.confirmTransaction(sig, 'confirmed');
      
      console.log(`Created custom token ATA through smart contract:`, sig);
      setAtaSuccess('Token enabled! You can now receive this token at your vault.');
      setShowAddTokenModal(false);
      setCustomMint('');
      
      // Refresh balance
      queryClient.invalidateQueries({ queryKey: ['vault-balance'] });
    } catch (err) {
      console.error('Error creating ATA:', err);
      setAtaError(err instanceof Error ? err.message : 'Failed to create token account');
    } finally {
      setIsCreatingAta(false);
    }
  }, [ownerAddress, endpoint, signTransaction, queryClient, customMint]);

  if (!ownerAddress) {
    return (
      <Card className="w-full max-w-2xl p-6 border border-border shadow-xl mb-6">
        <h2 className="text-2xl font-semibold mb-2">My Vault</h2>
        <p className="text-sm text-muted-foreground">Connect your wallet to view vault balance</p>
      </Card>
    );
  }

  if (vaultBalance.isLoading) {
    return (
      <Card className="w-full max-w-2xl p-6 border border-border shadow-xl mb-6">
        <h2 className="text-2xl font-semibold mb-2">My Vault</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  if (vaultBalance.error) {
    return (
      <Card className="w-full max-w-2xl p-6 border border-border shadow-xl mb-6">
        <h2 className="text-2xl font-semibold mb-2">My Vault</h2>
        <p className="text-sm text-destructive">Error loading vault</p>
      </Card>
    );
  }

  const data = vaultBalance.data;

  if (!data) {
    return (
      <Card className="w-full max-w-2xl p-6 border border-border shadow-xl mb-6">
        <h2 className="text-2xl font-semibold mb-2">My Vault</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Your vault has not been initialized yet. Secure a domain to create your vault.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-2xl p-6 border border-border shadow-xl mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold mb-1">My Vault</h2>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Vault: <span className="font-mono">{truncateAddress(data.vaultAddress)}</span>
            </p>
            <a
              href={`https://solscan.io/account/${data.vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View →
            </a>
          </div>
        </div>
      </div>

      {/* Status Messages */}
      {ataError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {ataError}
        </div>
      )}
      
      {ataSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {ataSuccess}
        </div>
      )}

      {/* Token Balances - check ataCount to determine if vault is initialized */}
      {data.ataCount > 0 ? (
        <div className="space-y-2">
          {/* SOL Native Balance */}
          {data.solBalance > 0 && (
            <div className="rounded-lg border border-border bg-card/50 p-3 hover:bg-card/80 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TokenIcon logoUri="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" symbol="SOL" size={32} />
                  <p className="font-medium">SOL</p>
                </div>
                <p className="font-medium">{formatNumber(data.solBalance)}</p>
              </div>
            </div>
          )}
          {/* SPL Token Balances */}
          {data.tokens.filter(t => t.uiAmount > 0).map((token) => (
            <div
              key={token.mint}
              className="rounded-lg border border-border bg-card/50 p-3 hover:bg-card/80 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TokenIcon logoUri={token.logoUri} symbol={token.symbol} size={32} />
                  <p className="font-medium">{token.symbol || 'Unknown Token'}</p>
                </div>
                <p className="font-medium">{formatNumber(token.uiAmount)}</p>
              </div>
            </div>
          ))}
          {/* Empty state when no balances */}
          {data.solBalance === 0 && data.tokens.filter(t => t.uiAmount > 0).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No token balances
            </p>
          )}
        </div>
      ) : (
        /* No ATAs yet - show Init Vault button */
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-4">
            Your vault has no token accounts yet. Initialize to start receiving tokens.
          </p>
          <Button
            onClick={handleInitVault}
            disabled={isInitializing}
            className="mb-4"
          >
            {isInitializing ? 'Initializing...' : '🚀 Init Vault'}
          </Button>
          
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">Will enable these tokens:</p>
            <div className="space-y-1">
              {DEFAULT_VAULT_TOKENS.map((token) => (
                <p key={token.mint} className="text-xs text-muted-foreground font-mono">
                  <span className="font-semibold text-foreground">{token.symbol}</span>{' '}
                  ({truncateAddress(token.mint)})
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Supported Tokens Section (shown when vault has ATAs) */}
      {data.ataCount > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Supported tokens:</span>{' '}
              <a 
                href={`https://solscan.io/account/${data.vaultAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary hover:underline"
              >
                SOL
              </a>
              {data.tokens.length > 0 && ', '}
              {data.tokens.map((token, i) => (
                <span key={token.mint}>
                  <a
                    href={`https://solscan.io/token/${token.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:text-primary hover:underline"
                  >
                    {token.symbol || 'Unknown'}
                  </a>
                  {i < data.tokens.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAddTokenModal(true)}
              className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
            >
              + Add
            </Button>
          </div>
        </div>
      )}

      {/* Add Token Modal */}
      {showAddTokenModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowAddTokenModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md p-6 bg-white shadow-xl">
              <h3 className="text-lg font-semibold mb-2">Enable New Token</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Enter the token mint address to enable receiving this token in your vault.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Token Mint Address</label>
                  <Input
                    type="text"
                    placeholder="Enter token mint address..."
                    value={customMint}
                    onChange={(e) => {
                      setAtaError(null);
                      setCustomMint(e.target.value);
                    }}
                    className={ataError ? 'border-destructive' : ''}
                    disabled={isCreatingAta}
                  />
                  {ataError && (
                    <p className="text-xs text-destructive mt-1">{ataError}</p>
                  )}
                </div>

                <div className="flex gap-3 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddTokenModal(false);
                      setCustomMint('');
                      setAtaError(null);
                    }}
                    disabled={isCreatingAta}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateCustomAta}
                    disabled={isCreatingAta || !customMint.trim()}
                  >
                    {isCreatingAta ? 'Creating...' : 'Enable Token'}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </Card>
  );
}

function DomainsView() {
  // Create RPC endpoint
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    return customRpc || 'https://api.mainnet-beta.solana.com';
  }, []);

  const { connected } = useConnector();
  const { account } = useAccount();
  const ownerAddress = useMemo(() => account ? account.address : null, [account]);
  const [createSubdomainModalVisible, setCreateSubdomainModalVisible] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Test transfer function - transfers gm.lumenless.sol to a new wallet
  const handleTestTransfer = useCallback(async () => {
    try {
      setIsTransferring(true);
      setTransferStatus('Preparing transfer...');
      
      const connection = new Connection(endpoint, 'confirmed');
      
      // Subdomain to transfer
      const subdomain = 'gm.lumenless.sol';
      // New owner address
      const currentOwner = new PublicKey('9Xt9Zj9HoAh13MpoB6hmY9UZz37L4Jabtyn8zE7AAsL');
      const newOwner = new PublicKey('FUCww3SgAmqiP4CswfgY2r2Nsf6PPzARrXraEnGCn4Ln');
      
      // Registry admin private key (base58 encoded)
      const adminPrivateKey = process.env.NEXT_PUBLIC_REGISTRAR_AUTHORITY_PRIVATE_KEY;
      if (!adminPrivateKey) {
        throw new Error('Admin private key not found');
      }
      const adminKeypair = Keypair.fromSecretKey(bs58.decode(adminPrivateKey));
      
      console.log('Admin public key:', adminKeypair.publicKey.toBase58());
      console.log('Transferring', subdomain, 'to', newOwner.toBase58());
      
      // isParentOwnerSigner = false means the current subdomain owner signs
      // owner = adminKeypair.publicKey is the current owner of the subdomain
      const transferIx = await transferSubdomain(
        connection,
        subdomain,
        newOwner,
        true, // isParentOwnerSigner - subdomain owner signs, not parent owner
        currentOwner, // current owner of the subdomain
      );
      
      const transaction = new Transaction();
      transaction.add(transferIx);
      transaction.feePayer = adminKeypair.publicKey;
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      
      // Sign with admin keypair
      transaction.sign(adminKeypair);
      
      setTransferStatus('Sending transaction...');
      
      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      
      setTransferStatus(`Confirming... (${sig.slice(0, 8)}...)`);
      
      await connection.confirmTransaction(sig, 'confirmed');
      
      setTransferStatus(`Success! TX: ${sig.slice(0, 8)}...${sig.slice(-8)}`);
      console.log('Transfer successful:', sig);
      
      // Refresh domains list
      queryClient.invalidateQueries({ queryKey: ['domains-for-owner'] });
      queryClient.invalidateQueries({ queryKey: ['wrapped-domains'] });
      
    } catch (err) {
      console.error('Transfer error:', err);
      setTransferStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTransferring(false);
    }
  }, [endpoint, queryClient]);
  
  // Use our custom hook to fetch unwrapped domains (replaces @bonfida/sns-react)
  // The hook returns { data, isLoading, error } structure
  const unwrappedDomains = useDomainsForOwner(
    endpoint, 
    ownerAddress, 
    { enabled: ownerAddress !== null }
  );

  // Fetch wrapped domains (domains that have been wrapped into NFTs)
  const wrappedDomains = useWrappedDomains(endpoint, ownerAddress);

  // Fetch all subdomains owned by the user (across all parent domains)
  const subdomains = useSubdomainsForOwner(
    endpoint,
    ownerAddress,
    { enabled: ownerAddress !== null }
  );

  // Fetch secured domains from the user's vault
  const securedDomains = useSecuredDomains(
    endpoint,
    ownerAddress,
    { enabled: ownerAddress !== null }
  );

  // Debug logging for subdomains
  useEffect(() => {
    console.log('[DomainsView] Subdomains query state:', {
      ownerAddress,
      enabled: ownerAddress !== null,
      isLoading: subdomains.isLoading,
      isFetching: subdomains.isFetching,
      error: subdomains.error,
      data: subdomains.data,
      dataLength: subdomains.data?.length || 0,
    });
  }, [ownerAddress, subdomains.isLoading, subdomains.isFetching, subdomains.error, subdomains.data]);

  // Debug logging for wrapped domains
  useEffect(() => {
    if (connected && ownerAddress && wrappedDomains.data !== undefined) {
      console.log('[DomainsView] Wrapped domains query:', {
        isLoading: wrappedDomains.isLoading,
        error: wrappedDomains.error,
        data: wrappedDomains.data,
        count: wrappedDomains.data?.length || 0,
      });
    }
  }, [connected, ownerAddress, wrappedDomains.isLoading, wrappedDomains.error, wrappedDomains.data]);

  // Debug logging for subdomains
  useEffect(() => {
    if (connected && ownerAddress && subdomains.data !== undefined) {
      console.log('[DomainsView] Subdomains query:', {
        isLoading: subdomains.isLoading,
        error: subdomains.error,
        data: subdomains.data,
        count: subdomains.data?.length || 0,
      });
    }
  }, [connected, ownerAddress, subdomains.isLoading, subdomains.error, subdomains.data]);

  // Create a set of secured domain mints/pubkeys for quick lookup
  const securedMints = useMemo(() => {
    const mints = new Set<string>();
    if (securedDomains.data) {
      securedDomains.data.forEach(d => {
        if (d.mintAddress) mints.add(d.mintAddress);
        mints.add(d.pubkey); // Also add pubkey for unwrapped domains
      });
    }
    return mints;
  }, [securedDomains.data]);

  // Combine unwrapped, wrapped, secured, and subdomains with their status
  const allDomains = useMemo(() => {
    const domainsList: Array<{ 
      domain: string; 
      pubkey: string | ReturnType<typeof address>; 
      isWrapped: boolean;
      isSubdomain: boolean;
      isSecured: boolean;
      parentDomain?: string;
    }> = [];
    
    // Track which domains we've already added (to avoid duplicates)
    const seenDomains = new Set<string>();
    
    // Add secured domains first (isSecured: true)
    // These are domains in the vault PDA (can be wrapped or unwrapped, domains or subdomains)
    if (securedDomains.data) {
      securedDomains.data.forEach(d => {
        const key = `${d.domain}-${d.isSubdomain ? 'subdomain' : 'domain'}-secured`;
        if (!seenDomains.has(key)) {
          seenDomains.add(key);
          seenDomains.add(d.domain); // Also mark the domain name as seen
          domainsList.push({
            domain: d.domain,
            pubkey: d.pubkey,
            isWrapped: d.isWrapped,
            isSubdomain: d.isSubdomain || false,
            isSecured: true,
            parentDomain: d.parentDomain,
          });
        }
      });
    }
    
    // Add unwrapped domains (isWrapped: false, isSubdomain: false, isSecured: false)
    if (unwrappedDomains.data) {
      unwrappedDomains.data.forEach(d => {
        if (!seenDomains.has(d.domain)) {
          seenDomains.add(d.domain);
          domainsList.push({ 
            ...d, 
            isWrapped: false,
            isSubdomain: false,
            isSecured: false,
          });
        }
      });
    }
    
    // Add wrapped domains (isWrapped: true, isSubdomain: false)
    // Check if they're secured by looking up the mint in securedMints
    if (wrappedDomains.data) {
      wrappedDomains.data.forEach(d => {
        if (!seenDomains.has(d.domain)) {
          seenDomains.add(d.domain);
          const pubkeyStr = typeof d.pubkey === 'string' ? d.pubkey : String(d.pubkey);
          const isSecured = securedMints.has(pubkeyStr);
          domainsList.push({ 
            ...d, 
            isWrapped: true,
            isSubdomain: false,
            isSecured,
          });
        }
      });
    }
    
    // Add subdomains (isWrapped: false, isSubdomain: true, isSecured: false)
    if (subdomains.data) {
      subdomains.data.forEach(d => {
        const fullDomain = `${d.domain}.${d.parentDomain}`;
        if (!seenDomains.has(fullDomain)) {
          seenDomains.add(fullDomain);
          domainsList.push({ 
            domain: d.domain,
            pubkey: d.pubkey,
            isWrapped: false,
            isSubdomain: true,
            isSecured: false,
            parentDomain: d.parentDomain,
          });
        }
      });
    }
    
    return domainsList;
  }, [unwrappedDomains.data, wrappedDomains.data, subdomains.data, securedDomains.data, securedMints]);

  // Combined loading state
  const isLoading = unwrappedDomains.isLoading || wrappedDomains.isLoading || subdomains.isLoading || securedDomains.isLoading;
  const error = unwrappedDomains.error || wrappedDomains.error || subdomains.error || securedDomains.error;

  // Debug logging - log domains list to console
  useEffect(() => {
    if (connected && ownerAddress) {
      console.log('=== SNS Domains Debug ===');
      console.log('Wallet Address:', ownerAddress);
      console.log('Loading:', isLoading);
      console.log('Error:', error);
      
      console.log('Unwrapped Domains:', unwrappedDomains.data?.length || 0);
      console.log('Wrapped Domains:', wrappedDomains.data?.length || 0);
      console.log('Subdomains:', subdomains.data?.length || 0);
      console.log('Secured Domains (in vault):', securedDomains.data?.length || 0);
      
      // Log secured domains details
      if (securedDomains.data && securedDomains.data.length > 0) {
        console.log('Secured Domains Details:');
        securedDomains.data.forEach((d, i) => {
          console.log(`  ${i + 1}. ${d.domain}${d.parentDomain ? `.${d.parentDomain}` : ''}.sol`);
          console.log(`     pubkey: ${d.pubkey}, isWrapped: ${d.isWrapped}, isSubdomain: ${d.isSubdomain}`);
        });
      }
      
      if (allDomains.length > 0) {
        console.log('Total Domains Found:', allDomains.length);
        console.log('Domains List:');
        allDomains.forEach((domainItem: { domain: string; pubkey: string | ReturnType<typeof address> }, index: number) => {
          const pubkeyStr = typeof domainItem.pubkey === 'string' ? domainItem.pubkey : String(domainItem.pubkey);
          console.log(`  ${index + 1}. ${domainItem.domain}.sol`);
          console.log(`     Domain Account: ${pubkeyStr}`);
        });
        console.log('Note: Fund receiving addresses (SOL records) are loaded per domain below.');
      } else if (!isLoading && !error) {
        console.log('No domains found for this wallet');
      }
      console.log('========================');
    }
  }, [connected, ownerAddress, isLoading, error, allDomains, unwrappedDomains.data, wrappedDomains.data, subdomains.data, securedDomains.data]);

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
      <main className="px-4 md:px-8 py-8 flex flex-col items-center">
        {/* Vault Balance Card */}
        {connected && <VaultBalanceCard endpoint={endpoint} ownerAddress={ownerAddress} />}
        
        <Card className="w-full max-w-2xl p-6 border border-border shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-semibold mb-2">My SNS Domains</h2>
              <p className="text-sm text-muted-foreground">
                View all your Solana Name Service domains
              </p>
            </div>
            {connected && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    onClick={() => setCreateSubdomainModalVisible(true)}
                    variant="default"
                  >
                    Create Subdomain
                  </Button>
                  <Button
                    onClick={handleTestTransfer}
                    variant="outline"
                    disabled={isTransferring}
                    className="text-orange-600 border-orange-600 hover:bg-orange-50"
                  >
                    {isTransferring ? 'Transferring...' : 'Test Transfer'}
                  </Button>
                </div>
                {transferStatus && (
                  <p className={`text-xs ${transferStatus.startsWith('Error') ? 'text-red-600' : transferStatus.startsWith('Success') ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {transferStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          {!connected && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Connect your wallet to view your domains</p>
            </div>
          )}

          {connected && isLoading && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading domains...</p>
            </div>
          )}

          {connected && error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 mb-4">
              <p className="text-sm text-destructive font-semibold">Failed to fetch domains</p>
              <p className="text-xs text-muted-foreground mt-2">
                {error instanceof Error ? error.message : String(error)}
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

          {connected && !isLoading && allDomains.length === 0 && !error && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No domains found</p>
            </div>
          )}

          {connected && !isLoading && allDomains.length > 0 && (
            <div className="space-y-3">
              {allDomains.map((domainItem) => {
                const pubkeyStr = typeof domainItem.pubkey === 'string' ? domainItem.pubkey : String(domainItem.pubkey);
                // Use domain name as key since it's what uniquely identifies each item
                // (pubkey can be shared temporarily during state transitions)
                const uniqueKey = domainItem.isSubdomain 
                  ? `${domainItem.domain}.${domainItem.parentDomain}` 
                  : domainItem.domain;
                return (
                  <DomainItem 
                    key={uniqueKey} 
                    domain={domainItem.domain}
                    pubkey={pubkeyStr}
                    isWrapped={domainItem.isWrapped}
                    isSubdomain={domainItem.isSubdomain}
                    parentDomain={domainItem.parentDomain}
                    mintAddress={domainItem.isWrapped ? pubkeyStr : undefined}
                    isSecuredProp={domainItem.isSecured}
                  />
                );
              })}
            </div>
          )}
        </Card>
      </main>

      <CreateSubdomainModal
        visible={createSubdomainModalVisible}
        onClose={() => setCreateSubdomainModalVisible(false)}
        parentDomain="lumenless"
        onSuccess={() => {
          // Invalidate queries to refresh the domains list
          queryClient.invalidateQueries({ queryKey: ['domains-for-owner'] });
          queryClient.invalidateQueries({ queryKey: ['wrapped-domains'] });
        }}
      />
    </div>
  );
}

