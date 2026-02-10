import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

const LAMPORTS_PER_SOL = 1e9;
const MINT_FEE_SOL = 0.05;
const MINT_FEE_LAMPORTS = BigInt(Math.floor(MINT_FEE_SOL * LAMPORTS_PER_SOL));

/**
 * POST /api/lumen-id/mint
 * Builds an unsigned transaction for the user to sign:
 * 1. Transfer 0.05 SOL from user to treasury
 * 2. Create user's ATA for Lumen ID mint if needed
 * 3. Mint 1 Lumen ID token to user (backend signs with mint authority)
 *
 * Request: { address: string }
 * Response: { transaction: string } (base64 serialized VersionedTransaction)
 *
 * Required env (mint must already exist; create once with SPL token or Metaplex):
 * - LUMEN_ID_TREASURY: Solana address to receive the 0.05 SOL
 * - LUMEN_ID_MINT: Public key of the Lumen ID token mint
 * - LUMEN_ID_MINT_AUTHORITY: Base58 secret key of the mint authority keypair
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Use POST with body { address: string } to build a mint transaction.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body as { address?: string };

    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid address' }, { status: 400 });
    }

    const treasury = process.env.LUMEN_ID_TREASURY;
    const mintPubkey = process.env.LUMEN_ID_MINT;
    const mintAuthoritySecret = process.env.LUMEN_ID_MINT_AUTHORITY;

    if (!treasury || !mintPubkey || !mintAuthoritySecret) {
      console.error('[Lumen ID] Missing env: LUMEN_ID_TREASURY, LUMEN_ID_MINT, or LUMEN_ID_MINT_AUTHORITY');
      return NextResponse.json(
        { error: 'Lumen ID mint not configured' },
        { status: 503 }
      );
    }

    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const userPubkey = new PublicKey(address);
    const treasuryPubkey = new PublicKey(treasury);
    const mint = new PublicKey(mintPubkey);

    let mintAuthorityKeypair: Keypair;
    try {
      const secret = bs58.decode(mintAuthoritySecret);
      mintAuthorityKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
    } catch {
      return NextResponse.json({ error: 'Invalid LUMEN_ID_MINT_AUTHORITY' }, { status: 500 });
    }

    const userAta = await getAssociatedTokenAddress(
      mint,
      userPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: treasuryPubkey,
        lamports: MINT_FEE_LAMPORTS,
      })
    );

    const ataInfo = await connection.getAccountInfo(userAta);
    if (!ataInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          userPubkey,
          userAta,
          userPubkey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    transaction.add(
      createMintToInstruction(
        mint,
        userAta,
        mintAuthorityKeypair.publicKey,
        1,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const message = transaction.compileMessage();
    const versionedTx = new VersionedTransaction(message);
    versionedTx.sign([mintAuthorityKeypair]);

    const serialized = Buffer.from(versionedTx.serialize()).toString('base64');

    return NextResponse.json({ transaction: serialized });
  } catch (err) {
    console.error('[Lumen ID mint API] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to build mint transaction';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
