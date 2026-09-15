# Security and secret handling

## Before deployment

1. Rotate the Firebase Web API key that was previously committed, then restrict its use in Google Cloud Console to your deployed domains and the Firebase APIs the app needs. A Firebase web API key is an identifier rather than a server secret, but it must still be restricted to prevent quota abuse.
2. Create `artifacts/glimmr/.env` from `.env.example`. Never commit it. `VITE_*` values are embedded in the browser bundle, so never put private keys, database passwords, or service-account credentials in them.
3. Set `DATABASE_URL` and `CORS_ORIGIN` only in the API host's secret manager/environment configuration. `CORS_ORIGIN` is a comma-separated allowlist of browser origins, for example `https://app.example.com`.
4. Deploy the included Firebase rules with `firebase deploy --only firestore:rules,storage` and enable Firebase App Check enforcement in the Firebase Console.
5. Enable Firebase Authentication before allowing client writes. The supplied rules deny unauthenticated writes and only allow a user to access their own outings.

## Included controls

- No real Firebase configuration values are stored in source code.
- `.env.*` files are ignored, while `.env.example` remains tracked.
- Firestore denies by default; places are public read-only and outings are owner-only.
- Storage denies by default; uploads are owner-only, image-only, and capped at 5 MiB.
- The API disables framework disclosure, applies security response headers, enforces an origin allowlist, limits request bodies, and rate-limits requests in memory.

## Important limitations

The API rate limiter is intentionally simple and process-local. Replace it with an edge/WAF or shared store (such as Redis) before running multiple API instances. Firebase rules and API-key restrictions must be deployed in their respective consoles; committing these files alone does not activate them.
