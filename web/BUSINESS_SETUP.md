# Lumenless Business: multiple X accounts

Anyone can connect an X account via Business. OAuth verifies /users/me and stores tokens in the private business_x_accounts table keyed by stable X user ID. Each account receives https://lumenless.com/u/username. The main homepage remains @lumenless.

## Upgrade

Run sql/multi-account.sql in the existing Supabase project's SQL Editor before deploying this code. It adds the private accounts table and target fields/index on orders; old rows remain intact. Existing tweet-orders.sql is still needed for a fresh installation, followed by multi-account.sql.

Both domains must share the same Supabase project and X app. Required server env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, X_CLIENT_ID, X_CLIENT_SECRET, BUSINESS_APP_URL=https://business.lumenless.com, BUSINESS_SESSION_SECRET (64 random hex characters). Payment, Telegram and CRON_SECRET variables remain as documented in TWEET_ORDERS_SETUP.md. TWEET_ADMIN_TOKEN and token seed variables are not needed.

Callback: https://business.lumenless.com/api/business/x/callback (local: http://127.0.0.1:3017/api/business/x/callback). Register it in the confidential X app with tweet.read, tweet.write, users.read, media.write and offline.access. The app's X access/credits must allow every account that authorizes it.

## Routing and isolation

The wallet signs the target username with its order draft. The server resolves that username to a connected account and saves its immutable X ID. Publication and token refresh use that ID, verify /users/me matches it, and cannot fall back to another account's tokens. Changing a username does not reroute existing orders. Reconnect in Business to update the storefront username; if a previously connected username has been reassigned, support must resolve the existing directory conflict before it can be registered again.

Business sessions are encrypted host-only HttpOnly cookies valid for eight hours and contain only account metadata. Queue queries and every moderation action enforce ownership by X ID. Other accounts cannot read contacts/content, moderate, reconcile, refund or publish another account's orders. Logout clears the session, not the stored publishing connection. Export endpoint remains retired.

Main-account compatibility: old orders with no target ID use the existing @lumenless connection. New @lumenless OAuth connects its new account row and backfills legacy orders to its verified X ID. The publisher prefers that new row so only one credential store owns refresh rotation. The old singleton is retained as fallback until @lumenless reconnects. Do not manually copy its tokens into multiple active records.

Apply sql/account-pricing.sql and sql/account-escrow.sql (including published_at), and set the separate ESCROW_ENCRYPTION_KEY server secret before deployment. Each owner must save Publishing settings: tweet/thread prices, SOL/USDC/LUMEN/custom mint and a receiving wallet. Saving creates one custodial escrow wallet per X account. Until this setup is complete, new checkout is disabled. Per-account Telegram destinations are not included. Telegram notifications include the target username. A public directory is not exposed; users share their own storefront link from Business.

Run node --test tests/*.test.cjs, npm run build and targeted ESLint. Tests verify account ownership, queue filters, signed targets, token selection and mismatched X ID rejection. Live OAuth and posting require the account owner's approval and real payment; tests never publish.

## Paid Partnership

Apply sql/paid-partnership.sql after the multi-account upgrade. Business Publishing settings lets each authenticated account enable/disable X’s Paid Partnership label. Default is enabled. The server reads the preference from that account’s private credential record; it snapshots the boolean on the order when publication begins, sends paid_partnership for every post, and preserves the snapshot across retries and thread continuations. Existing published posts are not edited. Settings endpoints require the same owner session and same-origin writes.

Reference: https://docs.x.com/x-api/posts/manage-tweets/introduction

## Pricing and escrow

Order signatures include the displayed payment terms. The server checks current account settings and snapshots exact decimal/atomic amounts, mint, decimals and escrow recipient; later settings changes do not alter existing orders. SPL assets can be bought using SOL through Jupiter. Unsupported Token-2022 extensions are rejected. Existing orders without an escrow snapshot retain their original treasury/refund behavior.

The entire thread must publish successfully before published_at starts the 24-hour clock. After that, Claim 90% verifies every post still exists and belongs to the target account, both before preparation and before signing. The configured receiving wallet signs and pays transaction fees/ATA rent; the server co-signs with escrow. One atomic transaction sends 90% to the receiving wallet and 10% (rounded down in atomic units) to the platform treasury. Refunds return 100% to the buyer. Reject without refund stays locked pending manual resolution. This is server custody, not an on-chain escrow contract.

Keep a secure backup of ESCROW_ENCRYPTION_KEY: losing it makes escrow funds inaccessible. Escrow private keys use AES-256-GCM with fresh nonces and account-bound authenticated data, independently of X token encryption. They are never returned by public/settings/order APIs. A signed settlement is reserved in the database before broadcast. Retries resend the same transaction; a missing RPC history result never permits another payment automatically. Only a definitively finalized failed transaction can be reset; uncertain outcomes require reconciliation.

Validation uses mocked RPC/X calls and test keypairs; it does not transfer real funds. A small live end-to-end payment/refund/payout remains necessary before broad rollout.
