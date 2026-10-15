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
