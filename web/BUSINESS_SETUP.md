# Lumenless Business

Business provides OAuth 2.0 authorization with X and a temporary environment-variable export. The same X developer app is used by business.lumenless.com and lumenless.com. Each authorization belongs to the returned X user ID; no account is hardcoded in the Business flow.

## Local preview

Visit `http://127.0.0.1:3017/business`. The local environment already has a generated 32-byte hex `BUSINESS_SESSION_SECRET` and `BUSINESS_APP_URL=http://127.0.0.1:3017`. Add the same app's server-only `X_CLIENT_ID` and `X_CLIENT_SECRET` to `web/.env.local` and restart the server. In the X app, register the exact local callback:

```
http://127.0.0.1:3017/api/business/x/callback
```

The X app must be a confidential Web App, with `tweet.read tweet.write users.read media.write offline.access` available. The application explicitly verifies granted scopes. Live authorization cannot be verified until these app credentials and the callback allowlist are configured.

## Production domain

1. Deploy the existing `web/` Next.js project to the host serving Lumenless. Attach `business.lumenless.com` to that deployment and add the DNS record required by that host. The repository currently has no linked Vercel deployment or authenticated deployment CLI; no DNS or public deployment has been changed by this implementation.
2. Set `BUSINESS_APP_URL=https://business.lumenless.com`, a persistent random `BUSINESS_SESSION_SECRET` (64 hex characters), and the same X app's `X_CLIENT_ID` and `X_CLIENT_SECRET`. All replicas must use the same session encryption key. Keep the secret out of public environment variables and version control.
3. Register this exact callback in the X developer console:

```
https://business.lumenless.com/api/business/x/callback
```

The existing admin callback can remain on the app's allowlist. Middleware serves the Business page at the business hostname's root. Other product routes are not served on that hostname. `/business` also remains available for preview.

## Export and publishing handoff

After approving access on X, the user returns to Business with their account profile. **Reveal** and **Copy .env block** return only that session's `X_CLIENT_ID`, `X_ACCESS_TOKEN`, `X_REFRESH_TOKEN` and `X_TOKEN_EXPIRES_AT`. The app-level Client Secret is never returned to the browser. Configure the same app-level `X_CLIENT_SECRET` separately on lumenless.com.

For the current @lumenless publisher, copy the block into the server environment and restart/redeploy lumenless.com. Its existing `tweet_x_credentials` table is seeded only if it has no connection yet. It can use the initial access token until expiry, then refreshes and persists rotating tokens in the private database. If a publisher connection already exists, exported environment values do not overwrite its rotated database credentials; reconnect it through the admin OAuth flow instead. The single-account publisher still enforces @lumenless.

Business does not refresh exported tokens itself. This avoids two independent services competing to rotate the same refresh token. If another service refreshes that authorization, the copied refresh token may no longer be current. Generate a fresh authorization when needed.

## Session behavior

OAuth uses PKCE S256 and encrypted, authenticated state with a ten-minute lifetime. Credentials are held in an AES-256-GCM encrypted, HttpOnly, host-only cookie with a fifteen-minute lifetime, Secure in production and SameSite=Lax. Tokens are not put into URLs, local storage, the session summary API, or the database by Business. Export is a same-origin POST with session authorization. Responses are no-store; the Business page excludes analytics and applies CSP and anti-framing headers. Closing the session clears cookies and displayed credentials; it does not revoke the publishing server's X authorization or erase the system clipboard.

## Future accounts

This is an account authorization/export flow, not persistent registration yet. For registration, create a separate Business account/connection table keyed by the stable X user ID, with encrypted credentials and owner-scoped authorization, plus a central token refresh owner. Do not reuse the current publisher's singleton `tweet_x_credentials.id=1` for multiple users. Do not persist the shared X app Client Secret per customer or show it to customers. User credential sessions already carry separate X account IDs, so the callback can later persist each user's own connection rather than overwriting another user's credentials.

## Checks

`npm run test:business` covers encrypted session tampering/expiry, cross-origin requests, missing sessions, token isolation, PKCE, callback cancellation and state validation, credential export, and logout. `npm run test:tweet-orders` covers the existing checkout and publisher.

References: [X OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [Next.js CSP](https://nextjs.org/docs/app/guides/content-security-policy).
