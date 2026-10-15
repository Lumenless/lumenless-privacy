# Lumenless Business

Business connects @lumenless through X OAuth and saves tokens directly to the private Supabase tweet_x_credentials singleton (id=1). The lumenless.com publisher reads that row and refreshes tokens under its existing database lock. No copying tokens into env is required.

Both domains must use the same Supabase project and X app. Required server variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, X_CLIENT_ID, X_CLIENT_SECRET, BUSINESS_APP_URL=https://business.lumenless.com, BUSINESS_SESSION_SECRET (64 random hex characters).

Register https://business.lumenless.com/api/business/x/callback in X. Local testing uses http://127.0.0.1:3017/api/business/x/callback and BUSINESS_APP_URL=http://127.0.0.1:3017.

Authorize @lumenless. Only after a successful database write does Business show confirmation. Other accounts are rejected before writing. Reconnecting replaces the existing connection. Closing the browser session does not disconnect publishing. No additional SQL is needed if tweet-orders.sql was applied.

The encrypted cookie contains only account and confirmation metadata, never tokens. The retired export endpoint returns HTTP 410 even for old credential cookies. Tokens stay in the private service-role-only table, protected by RLS and revoked anon/authenticated access.

Future registration for arbitrary accounts requires separate owner-scoped records, not this publisher singleton.

Run npm run test:business, npm run test:tweet-orders and npm run build. Live OAuth requires the account owner to approve X access; tests never replace production credentials.
