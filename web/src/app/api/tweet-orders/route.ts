import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { draftSchema, MEDIA_BUCKET, signingMessage } from '@/lib/tweet-orders/model';
import { ApiError, checkOrigin, db, failure, hash } from '@/lib/tweet-orders/server';

import { decimalAtomic, termsFor } from '@/lib/tweet-orders/billing';
import { storefront } from '@/lib/business/accounts';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 70_000) throw new ApiError('Order is too large.', 413);
    const parsed = z.object({ draft: draftSchema, timestamp: z.number().int(), nonce: z.string().uuid(), signature: z.string().max(100) }).safeParse(JSON.parse(raw));
    if (!parsed.success) throw new ApiError(parsed.error.issues[0].message);
    const { draft, timestamp, nonce, signature } = parsed.data;
    if (Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new ApiError('Wallet authorization expired. Please sign again.');
    let verified = false;
    try { verified = nacl.sign.detached.verify(Buffer.from(signingMessage(draft, timestamp, nonce)), bs58.decode(signature), new PublicKey(draft.wallet).toBytes()); } catch { /* invalid key/signature */ }
    if (!verified) throw new ApiError('Invalid wallet authorization.', 401);
    const target = await storefront(draft.targetUsername || 'lumenless');
    if (!target.escrow_address || !target.payout_wallet || !target.x_user_id) throw new ApiError('This account must configure pricing and escrow before accepting orders.', 409);
    const terms = termsFor(target, draft.kind);
    if (!draft.paymentTerms || Object.keys(terms).some(key => draft.paymentTerms?.[key as keyof typeof terms] !== terms[key as keyof typeof terms])) throw new ApiError('Pricing changed. Reload the account page and sign a new order.', 409);
    if (draft.wallet === terms.recipient) throw new ApiError('Use a different wallet from the receiving wallet to pay for this order.');
    let amountAtomic: bigint;
    try { amountAtomic = decimalAtomic(terms.amount, terms.decimals); } catch { throw new ApiError('The account pricing is invalid.', 503); }
    const client = db();
    const { count, error: countError } = await client.from('tweet_orders').select('id', { count: 'exact', head: true })
      .eq('wallet', draft.wallet).gte('created_at', new Date(Date.now() - 3600_000).toISOString());
    if (countError) throw new ApiError('Order service unavailable.', 503);
    if ((count || 0) >= 10) throw new ApiError('Limit of ten orders per wallet per hour reached.', 429);
    const id = randomUUID(); const token = randomBytes(32).toString('hex');
    const tweets = draft.tweets.map((tweet, index) => ({ ...tweet, media: tweet.media.map((file, mediaIndex) => ({ ...file, path: `${id}/${index}/${mediaIndex}-${randomUUID()}` })) }));
    const { error } = await client.from('tweet_orders').insert({ id, escrow_account_id: target.x_user_id, target_x_user_id: target.x_user_id, target_username: target.username, wallet: draft.wallet, kind: draft.kind,
      tweets, email: draft.email || null, telegram: draft.telegram || null,
      amount_tokens: Number(terms.amount), payment_asset:terms.asset, payment_mint:terms.mint, payment_symbol:terms.symbol, payment_decimals:terms.decimals, payment_recipient:terms.recipient, payment_amount:terms.amount, payment_amount_atomic:amountAtomic.toString(), token_hash: hash(token), request_nonce: nonce });
    if (error) throw new ApiError(error.code === '23505' ? 'This wallet authorization was already used. Sign a new order.' : 'Could not save order.', error.code === '23505' ? 409 : 503);
    const uploads = [];
    for (const tweet of tweets) for (const file of tweet.media) {
      const { data, error: uploadError } = await client.storage.from(MEDIA_BUCKET).createSignedUploadUrl(file.path, { upsert: false });
      if (uploadError || !data) throw new ApiError('Could not prepare media upload.', 503);
      uploads.push({ path: file.path, url: data.signedUrl, type: file.type });
    }
    return NextResponse.json({ id, token, uploads, amountTokens: Number(terms.amount) }, { status: 201 });
  } catch (error) { return failure(error); }
}
