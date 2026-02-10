/**
 * Create the Lumen ID SBT mint on Solana mainnet.
 *
 * You can use a pre-defined (e.g. vanity) keypair so the mint has a nice public key:
 *   1. Generate a vanity keypair: solana-keygen grind --starts-with lumen:1
 *      (or use any pattern; save the keypair to a JSON file)
 *   2. Run this script with that keypair so the mint address is that public key.
 *
 * Usage:
 *   npx ts-node --esm scripts/create-lumen-id-mint.ts --payer ./path/to/payer-keypair.json
 *   npx ts-node --esm scripts/create-lumen-id-mint.ts --payer ./payer.json --mint-keypair ./lumen-id-mint-keypair.json
 *
 * Options:
 *   --payer <path>        (required) Path to payer keypair JSON (needs SOL for rent + fees)
 *   --mint-keypair <path> (optional) Path to mint keypair JSON. If omitted, a new keypair is generated.
 *                         Use a vanity keypair here to get a nice LUMEN_ID_MINT address.
 *   --rpc <url>           (optional) RPC URL (default: mainnet)
 *   --out <path>          (optional) Write mint authority secret to this file (base58, one line)
 *
 * After running, set in your env:
 *   LUMEN_ID_MINT=<printed mint address>
 *   LUMEN_ID_MINT_AUTHORITY=<printed base58 secret or content of --out file>
 *   LUMEN_ID_TREASURY=<your treasury address>
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Connection, Keypair } from '@solana/web3.js';
import { createMint } from '@solana/spl-token';
import bs58 from 'bs58';

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

function loadKeypair(path: string): Keypair {
  const resolved = path.startsWith('/') ? path : join(process.cwd(), path);
  const data = JSON.parse(readFileSync(resolved, 'utf-8'));
  const secret = Uint8Array.from(data);
  return Keypair.fromSecretKey(secret);
}

function parseArgs(): {
  payerPath: string;
  mintKeypairPath: string | null;
  rpc: string;
  outPath: string | null;
} {
  const args = process.argv.slice(2);
  let payerPath = '';
  let mintKeypairPath: string | null = null;
  let rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || DEFAULT_RPC;
  let outPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--payer' && args[i + 1]) {
      payerPath = args[++i];
    } else if (args[i] === '--mint-keypair' && args[i + 1]) {
      mintKeypairPath = args[++i];
    } else if (args[i] === '--rpc' && args[i + 1]) {
      rpc = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      outPath = args[++i];
    }
  }

  if (!payerPath) {
    console.error('Usage: npx ts-node --esm scripts/create-lumen-id-mint.ts --payer <path-to-payer-keypair.json> [--mint-keypair <path>] [--rpc <url>] [--out <path>]');
    console.error('');
    console.error('For a nice (vanity) mint address, generate a keypair first:');
    console.error('  solana-keygen grind --starts-with lumen:1');
    console.error('  (then save the keypair to a JSON file and pass it with --mint-keypair)');
    process.exit(1);
  }

  return { payerPath, mintKeypairPath, rpc, outPath };
}

async function main() {
  const { payerPath, mintKeypairPath, rpc, outPath } = parseArgs();

  const connection = new Connection(rpc, 'confirmed');
  const payer = loadKeypair(payerPath);

  const mintKeypair = mintKeypairPath ? loadKeypair(mintKeypairPath) : Keypair.generate();

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Mint keypair (LUMEN_ID_MINT address):', mintKeypair.publicKey.toBase58());
  if (mintKeypairPath) {
    console.log('(Using pre-defined keypair from', mintKeypairPath, ')');
  } else {
    console.log('(Using newly generated keypair; use --mint-keypair with a vanity keypair for a nice address)');
  }
  console.log('');

  console.log('Creating Lumen ID mint (decimals=0, no freeze authority)...');
  const mintAddress = await createMint(
    connection,
    payer,
    mintKeypair.publicKey, // mint authority = same keypair
    null,                   // no freeze authority
    0,                      // decimals (SBT / NFT style)
    mintKeypair,
    { commitment: 'confirmed' }
  );

  const secretBase58 = bs58.encode(mintKeypair.secretKey);

  console.log('');
  console.log('Done. Lumen ID mint created.');
  console.log('');
  console.log('Add these to your .env or deployment env:');
  console.log('');
  console.log('LUMEN_ID_MINT=' + mintAddress.toBase58());
  console.log('LUMEN_ID_MINT_AUTHORITY=' + secretBase58);
  console.log('LUMEN_ID_TREASURY=<your-treasury-wallet-address>');
  console.log('');

  if (outPath) {
    const resolved = outPath.startsWith('/') ? outPath : join(process.cwd(), outPath);
    writeFileSync(resolved, secretBase58 + '\n', 'utf-8');
    console.log('Mint authority secret (base58) written to:', resolved);
    console.log('Keep this file secret and do not commit it.');
  } else {
    console.log('Keep LUMEN_ID_MINT_AUTHORITY secret. Optionally save to a file with --out <path>.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
