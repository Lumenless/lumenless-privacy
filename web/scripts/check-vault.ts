/**
 * Debug script to check what's in a user's vault PDA
 * Run with: npx ts-node --esm scripts/check-vault.ts <WALLET_ADDRESS>
 */

import { Connection, PublicKey } from '@solana/web3.js';

const VAULT_PROGRAM_ID = new PublicKey('LUMPd26Acz4wqS8EBuoxPN2zhwCUF4npbkrqhLbM9AL');
const NAME_SERVICE_PROGRAM_ID = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');
const VAULT_SEED = Buffer.from('vault');
const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

function getVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

async function main() {
  const walletAddress = process.argv[2];
  
  if (!walletAddress) {
    console.log('Usage: npx ts-node --esm scripts/check-vault.ts <WALLET_ADDRESS>');
    console.log('Example: npx ts-node --esm scripts/check-vault.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    process.exit(1);
  }

  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const ownerPubkey = new PublicKey(walletAddress);
  const [vaultPDA, bump] = getVaultPDA(ownerPubkey);

  console.log('='.repeat(60));
  console.log('VAULT DEBUG INFO');
  console.log('='.repeat(60));
  console.log(`Wallet Address: ${walletAddress}`);
  console.log(`Vault PDA: ${vaultPDA.toBase58()}`);
  console.log(`Vault Bump: ${bump}`);
  console.log('');

  // Check if vault account exists
  const vaultInfo = await connection.getAccountInfo(vaultPDA);
  if (!vaultInfo) {
    console.log('❌ Vault account does NOT exist');
    console.log('   User needs to initialize vault first');
    process.exit(0);
  }

  console.log('✅ Vault account exists');
  console.log(`   Data length: ${vaultInfo.data.length} bytes`);
  console.log(`   Owner program: ${vaultInfo.owner.toBase58()}`);
  console.log('');

  // Parse vault data (8 byte discriminator + 32 byte owner + 1 byte bump + 8 byte domains_count)
  if (vaultInfo.data.length >= 49) {
    const storedOwner = new PublicKey(vaultInfo.data.slice(8, 40));
    const storedBump = vaultInfo.data[40];
    const domainsCount = vaultInfo.data.readBigUInt64LE(41);
    console.log('Vault Data:');
    console.log(`   Stored Owner: ${storedOwner.toBase58()}`);
    console.log(`   Stored Bump: ${storedBump}`);
    console.log(`   Domains Count: ${domainsCount}`);
  }
  console.log('');

  // Check for SNS name accounts owned by vault PDA
  console.log('Checking for SNS name accounts owned by vault PDA...');
  try {
    const nameAccounts = await connection.getProgramAccounts(NAME_SERVICE_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 32,
            bytes: vaultPDA.toBase58(),
          },
        },
      ],
    });

    console.log(`Found ${nameAccounts.length} name accounts owned by vault PDA`);
    
    for (const { pubkey, account } of nameAccounts) {
      const data = account.data;
      const parentName = new PublicKey(data.slice(0, 32)).toBase58();
      const owner = new PublicKey(data.slice(32, 64)).toBase58();
      
      console.log('');
      console.log(`  Name Account: ${pubkey.toBase58()}`);
      console.log(`    Parent: ${parentName}`);
      console.log(`    Owner: ${owner}`);
      console.log(`    Data length: ${data.length} bytes`);
    }
  } catch (error) {
    console.error('Error fetching name accounts:', error);
  }

  console.log('');
  console.log('='.repeat(60));
}

main().catch(console.error);
