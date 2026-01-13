import { PublicKey, Transaction, TransactionInstruction, Connection, SystemProgram } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// Program ID from our deployed contract
export const VAULT_PROGRAM_ID = new PublicKey('LUMPd26Acz4wqS8EBuoxPN2zhwCUF4npbkrqhLbM9AL');

// SNS Name Service Program ID
export const NAME_SERVICE_PROGRAM_ID = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');

// Seed for vault PDA
const VAULT_SEED = Buffer.from('vault');

/**
 * Get the token program ID for a given mint
 * Returns TOKEN_2022_PROGRAM_ID if the mint is owned by Token-2022, otherwise TOKEN_PROGRAM_ID
 */
export async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

// Instruction discriminators from the IDL
const INITIALIZE_VAULT_DISCRIMINATOR = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);
const DEPOSIT_DOMAIN_DISCRIMINATOR = Buffer.from([171, 18, 52, 229, 2, 180, 77, 114]);
const WITHDRAW_DOMAIN_DISCRIMINATOR = Buffer.from([147, 201, 125, 224, 211, 146, 142, 245]);
// Discriminators for unwrapped domains
const DEPOSIT_UNWRAPPED_DOMAIN_DISCRIMINATOR = Buffer.from([96, 225, 213, 173, 90, 111, 128, 32]);
const WITHDRAW_UNWRAPPED_DOMAIN_DISCRIMINATOR = Buffer.from([170, 189, 73, 129, 207, 42, 120, 91]);
// Discriminator for init_vault_token_account (sha256("global:init_vault_token_account")[0..8])
// Hex: a57a8af03703c554 -> [165, 122, 138, 240, 55, 3, 197, 84]
const INIT_VAULT_TOKEN_ACCOUNT_DISCRIMINATOR = Buffer.from([165, 122, 138, 240, 55, 3, 197, 84]);

/**
 * Get the vault PDA for a user
 */
export function getVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

/**
 * Check if a user's vault exists
 */
export async function vaultExists(
  connection: Connection,
  owner: PublicKey
): Promise<boolean> {
  const [vaultPDA] = getVaultPDA(owner);
  const accountInfo = await connection.getAccountInfo(vaultPDA);
  return accountInfo !== null;
}

/**
 * Check if a domain is secured (in the vault)
 * We check if the vault's token account for this domain mint has a balance of 1
 */
export async function isDomainSecured(
  connection: Connection,
  owner: PublicKey,
  domainMint: PublicKey
): Promise<boolean> {
  try {
    const [vaultPDA] = getVaultPDA(owner);
    
    // Get the vault's associated token account for this domain
    const vaultTokenAccount = await getAssociatedTokenAddress(
      domainMint,
      vaultPDA,
      true // allowOwnerOffCurve - required for PDAs
    );
    
    // Check if the token account exists and has balance
    const tokenAccountInfo = await connection.getAccountInfo(vaultTokenAccount);
    if (!tokenAccountInfo) {
      return false;
    }
    
    // Parse token account data to check balance
    // SPL Token account data layout: mint (32) + owner (32) + amount (8) + ...
    const data = tokenAccountInfo.data;
    if (data.length < 72) {
      return false;
    }
    
    // Read the amount (u64 at offset 64)
    const amount = data.readBigUInt64LE(64);
    return amount > BigInt(0);
  } catch (error) {
    console.error('Error checking if domain is secured:', error);
    return false;
  }
}

/**
 * Create initialize vault instruction
 */
export function createInitializeVaultInstruction(
  owner: PublicKey
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: INITIALIZE_VAULT_DISCRIMINATOR,
  });
}

/**
 * Create deposit domain instruction
 */
export async function createDepositDomainInstruction(
  owner: PublicKey,
  domainMint: PublicKey
): Promise<TransactionInstruction> {
  const [vaultPDA] = getVaultPDA(owner);
  
  // User's token account (where the domain NFT currently is)
  const userTokenAccount = await getAssociatedTokenAddress(
    domainMint,
    owner
  );
  
  // Vault's token account (where the domain will be deposited)
  const vaultTokenAccount = await getAssociatedTokenAddress(
    domainMint,
    vaultPDA,
    true // allowOwnerOffCurve - required for PDAs
  );
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: domainMint, isSigner: false, isWritable: false },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: DEPOSIT_DOMAIN_DISCRIMINATOR,
  });
}

/**
 * Create withdraw domain instruction
 */
export async function createWithdrawDomainInstruction(
  owner: PublicKey,
  domainMint: PublicKey
): Promise<TransactionInstruction> {
  const [vaultPDA] = getVaultPDA(owner);
  
  // Vault's token account (where the domain NFT currently is)
  const vaultTokenAccount = await getAssociatedTokenAddress(
    domainMint,
    vaultPDA,
    true // allowOwnerOffCurve - required for PDAs
  );
  
  // User's token account (where the domain will be withdrawn to)
  const userTokenAccount = await getAssociatedTokenAddress(
    domainMint,
    owner
  );
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: domainMint, isSigner: false, isWritable: false },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: WITHDRAW_DOMAIN_DISCRIMINATOR,
  });
}

/**
 * Build a complete deposit transaction
 * Includes vault initialization if needed
 */
export async function buildDepositTransaction(
  connection: Connection,
  owner: PublicKey,
  domainMint: PublicKey
): Promise<Transaction> {
  const transaction = new Transaction();
  
  // Check if vault exists, if not add initialization instruction
  const hasVault = await vaultExists(connection, owner);
  if (!hasVault) {
    transaction.add(createInitializeVaultInstruction(owner));
  }
  
  // Add deposit instruction
  const depositIx = await createDepositDomainInstruction(owner, domainMint);
  transaction.add(depositIx);
  
  return transaction;
}

/**
 * Build a complete withdraw transaction
 */
export async function buildWithdrawTransaction(
  owner: PublicKey,
  domainMint: PublicKey
): Promise<Transaction> {
  const transaction = new Transaction();
  
  // Add withdraw instruction
  const withdrawIx = await createWithdrawDomainInstruction(owner, domainMint);
  transaction.add(withdrawIx);
  
  return transaction;
}

/**
 * Create deposit unwrapped domain instruction
 */
export function createDepositUnwrappedDomainInstruction(
  owner: PublicKey,
  nameAccount: PublicKey
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: DEPOSIT_UNWRAPPED_DOMAIN_DISCRIMINATOR,
  });
}

/**
 * Create withdraw unwrapped domain instruction
 */
export function createWithdrawUnwrappedDomainInstruction(
  owner: PublicKey,
  nameAccount: PublicKey
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: WITHDRAW_UNWRAPPED_DOMAIN_DISCRIMINATOR,
  });
}

/**
 * Build a complete deposit transaction for unwrapped domain
 * Includes vault initialization if needed
 */
export async function buildDepositUnwrappedTransaction(
  connection: Connection,
  owner: PublicKey,
  nameAccount: PublicKey
): Promise<Transaction> {
  const transaction = new Transaction();
  
  // Check if vault exists, if not add initialization instruction
  const hasVault = await vaultExists(connection, owner);
  if (!hasVault) {
    transaction.add(createInitializeVaultInstruction(owner));
  }
  
  // Add deposit instruction
  const depositIx = createDepositUnwrappedDomainInstruction(owner, nameAccount);
  transaction.add(depositIx);
  
  return transaction;
}

/**
 * Build a complete withdraw transaction for unwrapped domain
 */
export function buildWithdrawUnwrappedTransaction(
  owner: PublicKey,
  nameAccount: PublicKey
): Transaction {
  const transaction = new Transaction();
  
  // Add withdraw instruction
  const withdrawIx = createWithdrawUnwrappedDomainInstruction(owner, nameAccount);
  transaction.add(withdrawIx);
  
  return transaction;
}

/**
 * Create init vault token account instruction
 * Creates an ATA for a specific token mint owned by the vault PDA
 * @param owner - The vault owner
 * @param tokenMint - The token mint address
 * @param tokenProgramId - The token program (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID)
 */
export function createInitVaultTokenAccountInstruction(
  owner: PublicKey,
  tokenMint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): TransactionInstruction {
  const [vaultPDA] = getVaultPDA(owner);
  
  // Get the vault's ATA for this token mint (using the correct token program)
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    vaultPDA,
    true, // allowOwnerOffCurve - required for PDAs
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: false },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  return new TransactionInstruction({
    keys,
    programId: VAULT_PROGRAM_ID,
    data: INIT_VAULT_TOKEN_ACCOUNT_DISCRIMINATOR,
  });
}

/**
 * Build a transaction to initialize vault with multiple token accounts
 * Creates the vault (if needed) and ATAs for all specified token mints
 * Automatically detects Token vs Token-2022 for each mint
 */
export async function buildInitVaultWithTokensTransaction(
  connection: Connection,
  owner: PublicKey,
  tokenMints: PublicKey[]
): Promise<Transaction> {
  const transaction = new Transaction();
  const [vaultPDA] = getVaultPDA(owner);
  
  // Check if vault exists, if not add initialization instruction
  const hasVault = await vaultExists(connection, owner);
  if (!hasVault) {
    transaction.add(createInitializeVaultInstruction(owner));
  }
  
  // Add init token account instructions for each mint (skip existing ATAs)
  for (const tokenMint of tokenMints) {
    // Detect which token program this mint belongs to
    let tokenProgramId: PublicKey;
    try {
      tokenProgramId = await getTokenProgramForMint(connection, tokenMint);
    } catch (e) {
      console.warn(`Failed to detect token program for mint ${tokenMint.toBase58()}, skipping:`, e);
      continue;
    }
    
    // Get ATA address using the correct token program
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPDA,
      true, // allowOwnerOffCurve - required for PDAs
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Check if ATA already exists
    const ataInfo = await connection.getAccountInfo(vaultTokenAccount);
    if (!ataInfo) {
      const initAtaIx = createInitVaultTokenAccountInstruction(owner, tokenMint, tokenProgramId);
      transaction.add(initAtaIx);
      console.log(`Adding ATA for ${tokenMint.toBase58()} using ${tokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'Token'} program`);
    }
  }
  
  return transaction;
}

/**
 * Fetch all NFT mints held in the user's vault
 * Returns an array of mint addresses for NFTs in the vault
 */
export async function fetchVaultNFTMints(
  connection: Connection,
  owner: PublicKey
): Promise<string[]> {
  try {
    const [vaultPDA] = getVaultPDA(owner);
    
    // Check if vault exists
    const vaultInfo = await connection.getAccountInfo(vaultPDA);
    if (!vaultInfo) {
      return [];
    }
    
    // Get all token accounts owned by the vault PDA
    const tokenAccounts = await connection.getTokenAccountsByOwner(vaultPDA, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    const nftMints: string[] = [];
    
    for (const { account } of tokenAccounts.value) {
      const data = account.data;
      
      // SPL Token account data layout:
      // mint (32) + owner (32) + amount (8) + delegate option (4) + delegate (32) + state (1) + ...
      if (data.length < 72) continue;
      
      // Read mint address (first 32 bytes)
      const mint = new PublicKey(data.slice(0, 32));
      
      // Read amount (u64 at offset 64)
      const amount = data.readBigUInt64LE(64);
      
      // NFTs have amount of 1
      if (amount === BigInt(1)) {
        nftMints.push(mint.toBase58());
      }
    }
    
    return nftMints;
  } catch (error) {
    console.error('Error fetching vault NFT mints:', error);
    return [];
  }
}

/**
 * Fetch all unwrapped SNS domains owned by the vault PDA
 * Returns an array of name account pubkeys
 */
export async function fetchVaultUnwrappedDomains(
  connection: Connection,
  owner: PublicKey
): Promise<Array<{ nameAccount: string; parentName: string }>> {
  try {
    const [vaultPDA] = getVaultPDA(owner);
    
    // Check if vault exists and get domains count
    const vaultInfo = await connection.getAccountInfo(vaultPDA);
    if (!vaultInfo) {
      console.log(`[fetchVaultUnwrappedDomains] Vault does not exist for owner: ${owner.toBase58()}`);
      return [];
    }
    
    // Parse vault data to get domains count
    let domainsCount = 0;
    if (vaultInfo.data.length >= 49) {
      domainsCount = Number(vaultInfo.data.readBigUInt64LE(41));
    }
    
    console.log(`[fetchVaultUnwrappedDomains] Vault exists, domains_count: ${domainsCount}`);
    console.log(`[fetchVaultUnwrappedDomains] Looking for domains owned by vault: ${vaultPDA.toBase58()}`);
    
    // Query SNS Name Service for accounts where owner (at offset 32) is the vault PDA
    // Name registry account layout:
    // parent_name (32) + owner (32) + class (32) + data...
    console.log(`[fetchVaultUnwrappedDomains] Calling getProgramAccounts on Name Service...`);
    
    const accounts = await connection.getProgramAccounts(NAME_SERVICE_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 32, // owner field starts at byte 32
            bytes: vaultPDA.toBase58(),
          },
        },
      ],
    });
    
    console.log(`[fetchVaultUnwrappedDomains] ✅ getProgramAccounts returned ${accounts.length} accounts`);
    
    const domains: Array<{ nameAccount: string; parentName: string }> = [];
    
    for (const { pubkey, account } of accounts) {
      const data = account.data;
      console.log(`[fetchVaultUnwrappedDomains] Processing account: ${pubkey.toBase58()}, data length: ${data.length}`);
      
      if (data.length < 96) {
        console.log(`[fetchVaultUnwrappedDomains] Skipping - data too short`);
        continue;
      }
      
      // Read parent name (first 32 bytes)
      const parentName = new PublicKey(data.slice(0, 32)).toBase58();
      
      console.log(`[fetchVaultUnwrappedDomains] Found name account: ${pubkey.toBase58()}, parent: ${parentName}`);
      
      domains.push({
        nameAccount: pubkey.toBase58(),
        parentName,
      });
    }
    
    console.log(`[fetchVaultUnwrappedDomains] Returning ${domains.length} domains`);
    return domains;
  } catch (error) {
    console.error('[fetchVaultUnwrappedDomains] ❌ Error:', error);
    // Log more details about the error
    if (error instanceof Error) {
      console.error('[fetchVaultUnwrappedDomains] Error message:', error.message);
      console.error('[fetchVaultUnwrappedDomains] Error stack:', error.stack);
    }
    return [];
  }
}

