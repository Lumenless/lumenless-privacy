// Transfer service - handles token and SOL transfers from paylinks
// Uses @solana/kit for transaction building, tweetnacl for signing
import {
  createSolanaRpc,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  type Address,
  lamports,
  type TransactionSigner,
} from '@solana/kit';
import {
  getTransferSolInstruction,
} from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SOLANA_RPC_URL } from '../constants/solana';
import { TokenAccount } from './tokens';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Validate Solana wallet address
export function isValidSolanaAddress(addressStr: string): boolean {
  try {
    if (!addressStr || typeof addressStr !== 'string') return false;
    if (addressStr.length < 32 || addressStr.length > 44) return false;
    
    const decoded = bs58.decode(addressStr);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export interface ClaimResult {
  totalTokens: number;
  successfulTransfers: number;
  failedTransfers: number;
  signatures: string[];
  errors: string[];
}

// Create a minimal TransactionSigner for instruction building
// The actual signing is done manually with tweetnacl
function createDummySigner(addr: Address): TransactionSigner<string> {
  return {
    address: addr,
  } as TransactionSigner<string>;
}

// Claim all tokens from a paylink to a destination wallet in a SINGLE transaction
export async function claimAllTokens(
  secretKeyBase58: string,
  destinationAddress: string,
  tokens: TokenAccount[]
): Promise<ClaimResult> {
  const result: ClaimResult = {
    totalTokens: tokens.length,
    successfulTransfers: 0,
    failedTransfers: 0,
    signatures: [],
    errors: [],
  };
  
  if (tokens.length === 0) {
    return result;
  }
  
  try {
    console.log(`[Transfer] Building single transaction for ${tokens.length} token(s)`);
    
    // Create RPC client
    const rpc = createSolanaRpc(SOLANA_RPC_URL);
    
    // Use tweetnacl to get keypair (this works reliably in React Native)
    const secretKeyBytes = bs58.decode(secretKeyBase58);
    const publicKeyBytes = secretKeyBytes.slice(32, 64);
    const sourceAddress: Address = bs58.encode(publicKeyBytes) as Address;
    const destination: Address = address(destinationAddress);
    
    // Create a signer for instruction building (actual signing done with tweetnacl)
    const signer = createDummySigner(sourceAddress);
    
    // Separate SOL from SPL tokens
    const solToken = tokens.find(t => t.mint === SOL_MINT);
    const splTokens = tokens.filter(t => t.mint !== SOL_MINT);
    
    // Collect all instructions
    const instructions: any[] = [];
    const processedTokens: string[] = [];
    
    // Build SPL token transfer instructions first (skip 0 balance)
    // TODO: Fix ATA derivation for SPL tokens - skipping for now
    for (const token of splTokens) {
      try {
        // Skip tokens with 0 balance
        if (token.amount <= 0) {
          console.log(`[Transfer] Skipping ${token.symbol || token.mint} - zero balance`);
          continue;
        }
        
        // Skip SPL tokens for now due to ATA derivation issues
        console.log(`[Transfer] Skipping SPL token ${token.symbol || token.mint} - not yet supported`);
        continue;
        
        console.log(`[Transfer] Building instructions for ${token.symbol || token.mint}`);
        
        const mintAddress: Address = address(token.mint);
        const rawAmount = BigInt(Math.floor(token.amount * Math.pow(10, token.decimals)));
        
        // Get source ATA
        const [sourceAta] = await findAssociatedTokenPda({
          mint: mintAddress,
          owner: sourceAddress,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        
        // Get destination ATA
        const [destAta] = await findAssociatedTokenPda({
          mint: mintAddress,
          owner: destination,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        
        // Add idempotent create ATA instruction
        instructions.push(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            owner: destination,
            mint: mintAddress,
            ata: destAta,
          })
        );
        
        // Add transfer instruction
        instructions.push(
          getTransferInstruction({
            source: sourceAta,
            destination: destAta,
            authority: signer,
            amount: rawAmount,
          })
        );
        
        processedTokens.push(token.symbol || token.mint);
      } catch (error: any) {
        console.error(`[Transfer] Error building instructions for ${token.symbol || token.mint}:`, error);
        result.failedTransfers++;
        result.errors.push(`${token.symbol || token.mint}: ${error?.message || 'Failed to build instruction'}`);
      }
    }
    
    // Build SOL transfer instruction last
    if (solToken) {
      try {
        console.log(`[Transfer] Building SOL transfer instruction`);
        const totalLamports = BigInt(Math.floor(solToken.amount * 1e9));
        
        // Transaction fee is ~5000 lamports per signature
        // Transfer all SOL minus fee so account closes (balance = 0)
        const txFee = BigInt(5000);
        const transferAmount = totalLamports > txFee ? totalLamports - txFee : BigInt(0);
        
        if (transferAmount > BigInt(0)) {
          instructions.push(
            getTransferSolInstruction({
              source: signer,
              destination: destination,
              amount: lamports(transferAmount),
            })
          );
          processedTokens.push('SOL');
          console.log(`[Transfer] SOL transfer: ${Number(transferAmount) / 1e9} SOL`);
        } else {
          console.log(`[Transfer] Skipping SOL - balance too low for fee`);
          result.failedTransfers++;
          result.errors.push('SOL: Balance too low to cover transaction fee');
        }
      } catch (error: any) {
        console.error(`[Transfer] Error building SOL instruction:`, error);
        result.failedTransfers++;
        result.errors.push(`SOL: ${error?.message || 'Failed to build instruction'}`);
      }
    }
    
    if (instructions.length === 0) {
      result.errors.push('No valid transfer instructions could be built');
      return result;
    }
    
    // Get recent blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    
    // Build transaction message
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      tx => setTransactionMessageFeePayer(sourceAddress, tx),
      tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      tx => appendTransactionMessageInstructions(instructions, tx),
    );
    
    // Compile transaction to get message bytes
    console.log(`[Transfer] Compiling transaction with ${instructions.length} instruction(s)`);
    const compiledTransaction = compileTransaction(transactionMessage);
    
    // Sign the message bytes using tweetnacl
    console.log(`[Transfer] Signing with tweetnacl...`);
    const messageBytes = new Uint8Array(compiledTransaction.messageBytes);
    
    // Debug: verify keys match
    const derivedPubKey = bs58.encode(publicKeyBytes);
    console.log(`[Transfer] Source address: ${sourceAddress}`);
    console.log(`[Transfer] Derived pubkey: ${derivedPubKey}`);
    console.log(`[Transfer] Message bytes length: ${messageBytes.length}`);
    console.log(`[Transfer] Secret key length: ${secretKeyBytes.length}`);
    
    const signature = nacl.sign.detached(messageBytes, secretKeyBytes);
    console.log(`[Transfer] Signature length: ${signature.length}`);
    
    // Verify signature locally before sending
    const isValid = nacl.sign.detached.verify(messageBytes, signature, publicKeyBytes);
    console.log(`[Transfer] Local signature verification: ${isValid}`);
    
    // Build the wire format transaction
    // Format: [signatures_count (compact-u16), ...signatures, message_bytes]
    const signatureCount = 1;
    const wireTransaction = new Uint8Array(1 + 64 + messageBytes.length);
    wireTransaction[0] = signatureCount; // 1 signature (fits in 1 byte for compact-u16)
    wireTransaction.set(signature, 1);
    wireTransaction.set(messageBytes, 1 + 64);
    
    // Convert to base64
    const base64Transaction = btoa(String.fromCharCode(...wireTransaction));
    
    // Send transaction
    console.log(`[Transfer] Sending transaction...`);
    const txSignature = await rpc.sendTransaction(base64Transaction as any, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    }).send();
    
    console.log(`[Transfer] SUCCESS: ${txSignature}`);
    result.successfulTransfers = processedTokens.length;
    result.signatures.push(txSignature);
    
  } catch (error: any) {
    console.error(`[Transfer] Transaction failed:`, error);
    console.error(`[Transfer] Error context:`, error?.context);
    result.failedTransfers = tokens.length;
    result.errors.push(error?.message || 'Transaction failed');
  }
  
  return result;
}
