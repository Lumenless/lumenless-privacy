# X credentials and API protection

## Deployment sequence

1. Add X_TOKEN_ENCRYPTION_KEY to Vercel Production from the locally generated web/.env.local value. It is 32 random bytes encoded as 64 hex characters. Keep a secure backup; losing it loses access to encrypted credentials. Do not reuse BUSINESS_SESSION_SECRET, put it in Supabase, prefix it NEXT_PUBLIC_, print it in logs or commit it.
2. Apply sql/api-rate-limits.sql in the intended Supabase project. Both the private table and invoker RPCs deny public/anon/authenticated access; only service_role may consume/prune buckets.
3. Deploy the security-compatible code. Missing key/RPC causes protected API requests to fail closed with 503. The public session endpoint reports tokenStorageVersion and a non-secret key fingerprint so migration can verify the deployed key matches.
4. Run node scripts/migrate-x-tokens.cjs (inspection), then node scripts/migrate-x-tokens.cjs --execute. Execution refuses to proceed until production confirms the expected encryption version/key. It encrypts both business_x_accounts and the legacy tweet_x_credentials in place, uses row locks, verifies decrypted equality without printing tokens, skips already encrypted rows and can be rerun safely. No plaintext backup files are created.
5. All existing records have been migrated and verified. The current application rejects plaintext tokens; only the local migration utility can read legacy plaintext for a deployment-gated migration. Deploy the strict-decryption build. Do not roll back to a build that cannot decrypt credentials.

## Encryption

AES-256-GCM, a fresh 96-bit nonce and 128-bit authentication tag per value; additional authenticated data binds each token to its table, immutable account ID and access/refresh field. Ciphertext from another account/field cannot be substituted. Every OAuth write and refresh rotation encrypts both values. X_CLIENT_SECRET remains a Vercel secret. The database service key alone no longer decrypts tokens; compromise of both application runtime and its encryption key remains a threat.

Old Supabase backups may still contain historical plaintext until their retention expires. Encryption does not revoke old X authorizations. Supabase/Vercel organization access and MFA remain administrative controls.

## Rate limits

Middleware applies shared, atomic fixed-window limits before API handlers. OAuth start: 10/10 minutes/IP; callback: 20/10 minutes/IP; new orders: 20/10 minutes/IP; status lookup: 60/minute/IP; Business reads:120/minute/IP, writes:60/minute/IP; checkout:180/minute/IP; legacy PrivacyCash:30/minute/IP; other APIs:60/minute/IP. Authenticated moderation adds per-account read/write buckets. POSTs still enforce same-origin and ownership. Only Vercel's platform-forwarded IP is trusted; local development uses a shared local bucket. IP addresses are HMAC-hashed and are not stored raw in the limiter.

429 responses include Retry-After; limiter errors fail closed with 503. The authorized cron prunes expired buckets. Cron itself validates CRON_SECRET before doing work. This is application-level abuse protection, not a substitute for Vercel Firewall/DDoS protections; distributed attacks may still consume edge/database capacity and incur costs. Vercel Firewall configuration must be reviewed in the hosting account.

Next.js and React have patched versions pinned. Legacy Solana/PrivacyCash dependency advisories may need separate SDK migrations; do not use npm audit fix --force on payment dependencies without verifying transaction compatibility.

### Buyer refunds for unanswered orders

Apply `sql/review-timeout-refunds.sql` before deploying the refund endpoints. The
service-only, SECURITY INVOKER RPC atomically moves an order awaiting moderation
from `pending_review` to `refund_pending` only after 72 hours from `paid_at`.
`paid_at` is stamped when payment is first confirmed; historical pending escrow
orders receive a fresh 72-hour window when the SQL is applied. Approval/rejection
and a buyer claim compete through conditional database updates.

Buyers use `/orders?id=…`, connect the original paying wallet, sign an order-bound
five-minute authorization message, then separately sign the refund transaction.
The escrow returns 100% of the recorded payment asset to the original buyer with
zero platform fee; the buyer pays network fees and any token-account rent. Owner
approval and owner wallet signatures are unnecessary. Moderators cannot prepare,
reset, or broadcast these buyer-managed refunds. Signed settlement reservations
and finality checks prevent a second refund; ambiguous history remains locked for
reconciliation. The API is rate limited and never returns escrow keys or raw
stored signed transactions. Existing administrator-approved refunds retain their
original receiving-wallet signer flow.

### Publisher Telegram notifications

Apply `sql/business-telegram.sql`. Business owners link a private Telegram chat
using a random, hashed, single-use challenge valid for ten minutes. Link
creation/disconnection/test messages require the X Business session and same
origin. Neither chat IDs nor target X IDs are accepted from the browser.
`business_telegram` has RLS and no anon/authenticated grants. The service-only
invoker RPC consumes the challenge and binds its verified Telegram sender
atomically. The webhook checks Telegram's secret header before reading any
payload or database data; groups, bot senders and mismatched sender/chat IDs are
ignored. Its secret is domain-separated HMAC of the existing bot token, so no
additional environment variable is needed. Reconnect after rotating the bot
token to refresh Telegram's webhook secret.

The Connect Telegram action registers the webhook on BUSINESS_APP_URL and
refuses to overwrite a different existing webhook. Use the production HTTPS
Business URL, and keep the one-time link private. The bot's username is resolved
from getMe. The UI offers connection checks, test notifications and disconnect.
Delivery to the platform and account owner is tracked separately, retried by the
existing cron, and deduplicated when both destinations are the same chat.
Historical paid orders are not sent retroactively to newly connected owners.
As with most external message APIs, a crash after successful send but before the
database acknowledgement can cause a repeated notification on retry.
