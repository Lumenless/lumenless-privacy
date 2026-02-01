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
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { SOLANA_RPC_URL, PRIVACYCASH_CLAIMABLE_MINT_LIST, PRIVACYCASH_CLAIMABLE_MINTS } from '../constants/solana';
import { TokenAccount } from './tokens';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** MWA returns account address as base64; convert to base58 for display and API use. */
export function base64AddressToBase58(base64Address: string): string {
  const bytes = Buffer.from(base64Address, 'base64');
  return bs58.encode(bytes);
}

/** Tokens that can be claimed into PrivacyCash: SOL, USDC, USDT only */
export function getClaimablePrivacyCashTokens(tokens: TokenAccount[]): TokenAccount[] {
  const mints = new Set<string>(PRIVACYCASH_CLAIMABLE_MINT_LIST as unknown as string[]);
  return tokens.filter((t) => mints.has(t.mint) && t.amount > 0);
}

export function hasClaimablePrivacyCashTokens(tokens: TokenAccount[]): boolean {
  return getClaimablePrivacyCashTokens(tokens).length > 0;
}

/** Whether the pay link wallet has SOL (for gas). Used to decide fee payer when claiming into PrivacyCash. */
export function payLinkHasSolForGas(tokens: TokenAccount[]): boolean {
  const sol = tokens.find((t) => t.mint === SOL_MINT);
  if (!sol || sol.amount <= 0) return false;
  // Need at least ~0.001 SOL for a transaction
  return sol.amount >= 0.001;
}

// Rent-exempt minimum for token accounts (in lamports)
// This is the amount required to create an ATA
const TOKEN_ACCOUNT_RENT = 2_039_280n; // ~0.00203928 SOL

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
    let ataCreationCount = 0;
    const sourceAtasToClose: { account: PublicKey; tokenSymbol: string }[] = [];
    
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
        
        // Check if source ATA exists and has balance
        const sourceAtaInfo = await connection.getAccountInfo(sourceAta);
        if (!sourceAtaInfo) {
          console.log(`[Transfer] Source ATA does not exist for ${token.symbol || token.mint}, skipping`);
          continue;
        }
        
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
          ataCreationCount++;
          console.log(`[Transfer] Will create ATA for ${token.symbol || token.mint} (rent: ${Number(TOKEN_ACCOUNT_RENT) / 1e9} SOL)`);
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
        
        // Track source ATA to close after transfer
        sourceAtasToClose.push({
          account: sourceAta,
          tokenSymbol: token.symbol || token.mint,
        });
        
        processedTokens.push(token.symbol || token.mint);
      } catch (error: any) {
        console.error(`[Transfer] Error building instructions for ${token.symbol || token.mint}:`, error);
        result.failedTransfers++;
        result.errors.push(`${token.symbol || token.mint}: ${error?.message || 'Failed to build instruction'}`);
      }
    }
    
    // Close source token accounts after transfers (rent goes to destination)
    for (const { account, tokenSymbol } of sourceAtasToClose) {
      try {
        transaction.add(
          createCloseAccountInstruction(
            account,            // account to close
            destination,       // destination for rent (goes to destination wallet)
            keypair.publicKey, // owner/authority
            []                 // multisig signers (empty for single signer)
          )
        );
        console.log(`[Transfer] Will close source ATA for ${tokenSymbol} (rent ${Number(TOKEN_ACCOUNT_RENT) / 1e9} SOL → destination)`);
      } catch (error: any) {
        console.error(`[Transfer] Error building close instruction for ${tokenSymbol}:`, error);
        // Don't fail the whole transaction if closing fails, but log it
        result.errors.push(`${tokenSymbol} (close): ${error?.message || 'Failed to build close instruction'}`);
      }
    }
    
    // Calculate total rent needed for ATA creations
    const totalAtaRent = BigInt(ataCreationCount) * TOKEN_ACCOUNT_RENT;
    console.log(`[Transfer] Total ATA creation rent needed: ${ataCreationCount} ATAs × ${Number(TOKEN_ACCOUNT_RENT) / 1e9} SOL = ${Number(totalAtaRent) / 1e9} SOL`);
    
    // Calculate rent we'll get back from closing accounts (goes to destination)
    const rentFromClosing = BigInt(sourceAtasToClose.length) * TOKEN_ACCOUNT_RENT;
    if (rentFromClosing > 0) {
      console.log(`[Transfer] Will reclaim ${sourceAtasToClose.length} × ${Number(TOKEN_ACCOUNT_RENT) / 1e9} SOL = ${Number(rentFromClosing) / 1e9} SOL from closing accounts (→ destination)`);
    }
    
    // Build SOL transfer instruction last
    if (solToken) {
      try {
        console.log(`[Transfer] Building SOL transfer instruction`);
        const availableLamports = BigInt(Math.floor(solToken.amount * 1e9));
        
        // Transaction fee is ~5000 lamports per signature
        // We need to account for:
        // 1. Transaction fee (~5000 lamports)
        // 2. Rent for ATA creations (if any)
        // 3. Transfer the remaining SOL
        // Note: Rent from closing accounts goes directly to destination, not back to source
        const txFee = BigInt(5000);
        const totalRequired = txFee + totalAtaRent;
        
        console.log(`[Transfer] Available SOL: ${Number(availableLamports) / 1e9} SOL`);
        console.log(`[Transfer] Required for fees + rent: ${Number(totalRequired) / 1e9} SOL`);
        if (rentFromClosing > 0) {
          console.log(`[Transfer] Note: ${Number(rentFromClosing) / 1e9} SOL will be reclaimed from closed accounts and sent to destination`);
        }
        
        if (availableLamports <= totalRequired) {
          console.log(`[Transfer] Skipping SOL - balance too low (need ${Number(totalRequired) / 1e9} SOL, have ${Number(availableLamports) / 1e9} SOL)`);
          result.failedTransfers++;
          result.errors.push(`SOL: Balance too low. Need ${Number(totalRequired) / 1e9} SOL for fees and rent, have ${Number(availableLamports) / 1e9} SOL`);
        } else {
          // Transfer remaining SOL after fees and rent
          const transferAmount = availableLamports - totalRequired;
          
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: destination,
              lamports: Number(transferAmount),
            })
          );
          processedTokens.push('SOL');
          console.log(`[Transfer] SOL transfer: ${Number(transferAmount) / 1e9} SOL (${Number(availableLamports) / 1e9} - ${Number(totalRequired) / 1e9})`);
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

/** Result of claiming into PrivacyCash */
export interface ClaimToPrivacyCashResult {
  success: boolean;
  signatures: string[];
  error?: string;
}

/**
 * Claim SOL, USDC, USDT from Pay Link wallet into user's PrivacyCash balance.
 * 
 * IMPORTANT: PrivacyCash deposits go into the USER's PrivacyCash balance, not the pay link's.
 * This is because PrivacyCash uses the user's wallet signature to derive encryption keys.
 * 
 * Flow:
 * 1. First, transfer tokens from Pay Link to User's regular wallet
 * 2. Then, user deposits from their wallet into their PrivacyCash balance
 * 
 * The actual deposit is done via the backend API which handles ZK proof generation.
 * 
 * @param payLinkSecretKeyBase58 - Pay Link's secret key for signing transfers
 * @param userPublicKey - User's wallet public key (destination for transfer, source for deposit)
 * @param userSignMessage - Function to sign derivation message
 * @param userSignTransaction - Function to sign deposit transaction
 * @param claimableTokens - Tokens to claim (only SOL, USDC, USDT supported)
 * @param _payLinkHasSol - Whether pay link has SOL for gas (transfer fees)
 */
export async function claimToPrivacyCash(
  payLinkSecretKeyBase58: string,
  userPublicKey: string,
  userSignMessage: (message: Uint8Array) => Promise<Uint8Array>,
  userSignTransaction: (tx: Uint8Array) => Promise<Uint8Array>,
  claimableTokens: TokenAccount[],
  _payLinkHasSol: boolean
): Promise<ClaimToPrivacyCashResult> {
  if (claimableTokens.length === 0) {
    return { success: false, signatures: [], error: 'No SOL, USDC, or USDT to claim' };
  }

  console.log(`[ClaimToPrivacyCash] Starting claim for ${claimableTokens.length} token(s) to ${userPublicKey.slice(0, 8)}...`);

  // Import the deposit function from privacycash service
  const { depositToPrivacyCash } = await import('./privacycash');
  type TokenKind = 'SOL' | 'USDC' | 'USDT';

  const signatures: string[] = [];
  const errors: string[] = [];

  // Step 1: Transfer tokens from Pay Link to User's wallet
  console.log('[ClaimToPrivacyCash] Step 1: Transferring tokens from Pay Link to user wallet...');
  
  try {
    const claimResult = await claimAllTokens(payLinkSecretKeyBase58, userPublicKey, claimableTokens);
    
    // Check if transfer had failures
    if (claimResult.failedTransfers > 0 && claimResult.successfulTransfers === 0) {
      return { 
        success: false, 
        signatures: claimResult.signatures, 
        error: `Transfer failed: ${claimResult.errors.join('; ') || 'Unknown error'}` 
      };
    }
    
    signatures.push(...claimResult.signatures);
    console.log('[ClaimToPrivacyCash] Transfer complete, signatures:', claimResult.signatures);
    
    // Small delay to let the transfer confirm
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (err) {
    console.error('[ClaimToPrivacyCash] Transfer error:', err);
    return { 
      success: false, 
      signatures, 
      error: `Transfer failed: ${err instanceof Error ? err.message : 'Unknown error'}` 
    };
  }

  // Step 2: Deposit each token into PrivacyCash
  console.log('[ClaimToPrivacyCash] Step 2: Depositing tokens into PrivacyCash...');
  
  for (const token of claimableTokens) {
    // Determine token kind
    let tokenKind: TokenKind;
    if (token.mint === PRIVACYCASH_CLAIMABLE_MINTS.SOL) {
      tokenKind = 'SOL';
    } else if (token.mint === PRIVACYCASH_CLAIMABLE_MINTS.USDC) {
      tokenKind = 'USDC';
    } else if (token.mint === PRIVACYCASH_CLAIMABLE_MINTS.USDT) {
      tokenKind = 'USDT';
    } else {
      console.log(`[ClaimToPrivacyCash] Skipping unsupported token: ${token.symbol || token.mint}`);
      continue;
    }

    // Convert amount from raw units to human-readable units
    const humanAmount = token.amount / Math.pow(10, token.decimals);
    console.log(`[ClaimToPrivacyCash] Depositing ${humanAmount} ${tokenKind} into PrivacyCash...`);

    try {
      const depositResult = await depositToPrivacyCash(
        tokenKind,
        humanAmount,
        userPublicKey,
        userSignMessage,
        userSignTransaction
      );

      if (depositResult.success && depositResult.tx) {
        signatures.push(depositResult.tx);
        console.log(`[ClaimToPrivacyCash] ${tokenKind} deposit successful:`, depositResult.tx);
      } else {
        errors.push(`${tokenKind}: ${depositResult.error || 'Unknown error'}`);
        console.error(`[ClaimToPrivacyCash] ${tokenKind} deposit failed:`, depositResult.error);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${tokenKind}: ${errMsg}`);
      console.error(`[ClaimToPrivacyCash] ${tokenKind} deposit error:`, err);
    }
  }

  // Return result
  if (errors.length > 0 && signatures.length === claimableTokens.length) {
    // Partial success - transfer worked but some deposits failed
    return {
      success: true,
      signatures,
      error: `Some deposits failed: ${errors.join('; ')}`,
    };
  } else if (errors.length === claimableTokens.length) {
    // All deposits failed
    return {
      success: false,
      signatures,
      error: errors.join('; '),
    };
  }

  return { success: true, signatures };
}
