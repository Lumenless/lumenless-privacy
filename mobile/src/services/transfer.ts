// Transfer service - handles token and SOL transfers from paylinks
// Uses @solana/web3.js as recommended by Solana Mobile docs
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
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
    
    // Create connection and keypair
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const secretKey = bs58.decode(secretKeyBase58);
    const keypair = Keypair.fromSecretKey(secretKey);
    const destination = new PublicKey(destinationAddress);
    
    // Separate SOL from SPL tokens
    const solToken = tokens.find(t => t.mint === SOL_MINT);
    const splTokens = tokens.filter(t => t.mint !== SOL_MINT);
    
    // Create transaction
    const transaction = new Transaction();
    const processedTokens: string[] = [];
    
    // Build SPL token transfer instructions first
    for (const token of splTokens) {
      try {
        // Skip tokens with 0 balance
        if (token.amount <= 0) {
          console.log(`[Transfer] Skipping ${token.symbol || token.mint} - zero balance`);
          continue;
        }
        
        console.log(`[Transfer] Building instructions for ${token.symbol || token.mint}`);
        
        const mintPubkey = new PublicKey(token.mint);
        const rawAmount = BigInt(Math.floor(token.amount * Math.pow(10, token.decimals)));
        
        // Get source token account
        const sourceAta = await getAssociatedTokenAddress(
          mintPubkey,
          keypair.publicKey
        );
        
        // Get destination ATA (will create if needed)
        const destAta = await getAssociatedTokenAddress(
          mintPubkey,
          destination
        );
        
        // Check if destination ATA exists
        const destAtaInfo = await connection.getAccountInfo(destAta);
        
        if (!destAtaInfo) {
          // Add instruction to create destination ATA
          transaction.add(
            createAssociatedTokenAccountInstruction(
              keypair.publicKey, // payer
              destAta,           // ATA address
              destination,       // owner
              mintPubkey         // mint
            )
          );
        }
        
        // Add transfer instruction
        transaction.add(
          createTransferInstruction(
            sourceAta,          // source
            destAta,            // destination
            keypair.publicKey,  // owner
            rawAmount           // amount
          )
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
        const lamports = BigInt(Math.floor(solToken.amount * 1e9));
        
        // Transaction fee is ~5000 lamports per signature
        // Transfer all SOL minus fee so account closes (balance = 0)
        const txFee = BigInt(5000);
        const transferAmount = lamports > txFee ? lamports - txFee : BigInt(0);
        
        if (transferAmount > BigInt(0)) {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: destination,
              lamports: Number(transferAmount),
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
    
    if (transaction.instructions.length === 0) {
      result.errors.push('No valid transfer instructions could be built');
      return result;
    }
    
    // Send transaction
    console.log(`[Transfer] Sending transaction with ${transaction.instructions.length} instruction(s)`);
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      { commitment: 'confirmed' }
    );
    
    console.log(`[Transfer] SUCCESS: ${signature}`);
    result.successfulTransfers = processedTokens.length;
    result.signatures.push(signature);
    
  } catch (error: any) {
    console.error(`[Transfer] Transaction failed:`, error);
    result.failedTransfers = tokens.length;
    result.errors.push(error?.message || 'Transaction failed');
  }
  
  return result;
}
