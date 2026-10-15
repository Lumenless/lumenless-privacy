# Lumenless tweet orders

The web homepage sells posts on **@lumenless**. Connected accounts have their own `/u/@username` checkout; see BUSINESS_SETUP.md and apply sql/multi-account.sql after the initial schema. A single tweet costs **1,000,000 LUMEN**; a thread of **2–5 tweets costs 3,000,000 LUMEN**. Email and Telegram contacts are independently optional. Token mint: `6Q5t5upWJwDocysAwR2zertE2EPxB3X1ek1HRoj4LUM`. Treasury: `LUMthMRYXEvkekVVLkwMQr92huNK5x5jZGSQzpmCUjb`.

## Setup

1. Run `sql/tweet-orders.sql` in the intended Supabase project's SQL editor. It creates private order and OAuth credential tables and a private media bucket. It is a first-install bootstrap script, not an incremental migration. Existing waitlist tables are unaffected.
2. Add the missing variables from `tweet-orders.env.example` to `web/.env.local` and to the hosting environment. Never prefix service keys, private keys, OAuth credentials or bot tokens with `NEXT_PUBLIC_`. Use a mainnet RPC with transaction history; the server verifies its genesis hash. There is no treasury private key on the server.
3. Set the Telegram token for **@lumenless_bot** and `TELEGRAM_ADMIN_CHAT_ID=862473`. The recipient must first start the bot. Moderation requires signing in as the target X account on Business; no admin token is used.
4. Create a confidential OAuth 2.0 web app in X. Register `BUSINESS_APP_URL/api/business/x/callback` and grant `tweet.read tweet.write users.read media.write offline.access`. Set client ID and secret, sign in with the intended X account on Business and open its own moderation queue. Tokens are saved in the private database and renewed by the publisher. `TWEET_ADMIN_TOKEN` is not required. X API access/credits must support these endpoints.
5. Set a Jupiter API key. Without it, SOL checkout remains unavailable; LUMEN payments still work. The homepage remains closed for checkout until the core server environment and X connection are present.
6. The Vercel configuration calls `/api/cron/tweet-orders` every minute with `CRON_SECRET`. The hosting plan must support that schedule and 300-second functions. On other hosts, configure a scheduler that sends `Authorization: Bearer <CRON_SECRET>` to that endpoint. It retries pending Telegram notifications and continues approved posts whose videos are processing.
7. Run `npm run test:tweet-orders`, `npm run lint`, and `npm run build` in `web/`.

## Payment and recovery

Creation requires a signed wallet message containing the draft, timestamp, and nonce. Each order has a separate unguessable recovery token; the browser saves it locally, never in the URL. Content and attachments are fixed before payment. Upload URLs are signed with overwrite disabled, and the server checks file size/type/header before preparing payment.

Payment is a checked SPL-token transfer plus an order-specific memo. Mint decimals and token program are read on-chain. The server checks the exact transfer, treasury balance increase, wallet signature, memo, mainnet and finalized success. Transaction signatures are unique across orders. Transfer-fee token mints are intentionally rejected.

SOL checkout uses Jupiter Swap V2. It supports ExactIn: the server sizes a quote that guarantees enough LUMEN within the wallet's available SOL balance (with 0.005 SOL reserved for fees and rent) and 0.5% slippage, and rejects price impact above 5%. The wallet picker opens from a single Connect Wallet button. Checkout checks the LUMEN balance first and pays directly when sufficient; otherwise it obtains a SOL quote automatically. The buyer sees the quoted SOL amount and approximate fees, signs the swap, then signs the exact LUMEN payment. Surplus LUMEN remains in the buyer's wallet. A completed swap alone does not create a paid order. If a swap execution times out, inspect the wallet before requesting another swap; it may already have landed. Switch to LUMEN payment if the acquired balance is sufficient.

Payment/refund signatures are saved locally before broadcast and reserved server-side before sending. Use **Verify** or **Resend same transaction** after a timeout. **Reset failed or expired** allows another transaction only after a finalized failure or a missing transaction past its last valid finalized block height. Clearing browser storage loses the order recovery capability; keep the saved order data until the order is completed.

## Moderation, publishing, refunds

- **Approve & publish** commits approval then posts automatically through X API. Thread posts reply to the previous post, with every returned ID persisted.
- Photos and MP4 videos use the X v2 chunked media upload API. Videos still processing return to the approved queue and continue on the next scheduler run. X may reject a file for format, dimensions, codec, duration, account entitlement or content restrictions even after upload; the admin sees the failure and can address it.
- Definitive X errors remain `publish_failed` for explicit admin retry. Unknown POST outcomes become `publish_uncertain`. The admin checks @lumenless and either attaches the existing post ID (author/thread relationship checked) or explicitly confirms it does not exist before a retry. This avoids blind duplicate posting after timeouts.
- A publisher interrupted by the host remains `publishing`; **Recover stalled publication** becomes available after five minutes and preserves any uncertain POST marker.
- **Reject with refund** records `refund_pending`. Connect the treasury wallet, sign the reverse LUMEN transfer, then verify it. Only finalized refund proof marks it `refunded`. Refunds are in LUMEN even if the buyer originally swapped SOL, and network/swap fees are not returned.
- **Reject without refund** records a rejection and reason. The buyer explicitly accepts this possibility before paying.
- Telegram delivery is at least once. Failed notifications remain pending for cron/manual retry; a remote success followed by a database failure can produce a duplicate notification.

## Verification and deployment limits

Local tests exercise draft validation, payment/refund evidence, SOL precision, thread sequencing and ambiguous X responses. Live Supabase/RPC/Jupiter/X/Telegram flows require the configured credentials and a treasury wallet signature and must be exercised before opening production checkout. No real payments or posts are generated by the unit suite. Apply the schema and verify RLS/storage restrictions on the intended project, including direct anonymous access tests, before launch.

The legacy `/sns` page is redirected to `/` because it referenced `NEXT_PUBLIC_TEST_PRIVATE_KEY` and `NEXT_PUBLIC_REGISTRAR_AUTHORITY_PRIVATE_KEY` in client code. Its implementation is retained as `src/app/sns/LegacySnsPage.tsx` for reference and is not imported into the public route. If a previous deployment exposed these keys, rotate/revoke them and remove the old public environment variables before deployment. Other legacy privacy routes remain available; this change focuses on the new web checkout. The mobile application still contains Expo and was not migrated.

## Primary integration references

- [Jupiter Swap V2 order](https://developers.jup.ag/docs/api-reference/swap/order)
- [X create posts](https://docs.x.com/x-api/posts/create-post)
- [X chunked media upload](https://docs.x.com/x-api/media/quickstart/media-upload-chunked)
- [X OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [Supabase signed upload URLs](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
