# SignuDoc State

## 2026-11-16 Workspace Registration

- Private repository: `omattic/signudoc`, branch `main`.
- Local path: `/home/gnu/signudoc`.
- Telegram: `signudoc`, topic 37731, chat -1003996402615.
- Imported source: `NYLLON-SOFTWARE/SignuDoc` at `bb9bc099151fed39da5de017d9b4cd61b124cbbd`, with history and licensing retained.
- Product: Next.js electronic-signature application with PostgreSQL, document storage, and email integrations.
- Registration only: no dependency install, app build, runtime tests, credentials, or deployment performed. Application readiness is unverified.

## 2026-11-16 W7S Migration Started

- The target is one W7S deployment with D1, private R2 storage, Spanish at `firmar-documento.com`, and English at `document-signature.com`. There are no existing clients or data to migrate.
- The two domains are declared in `CNAME`; DNS, TLS, deployment, localization, and application integration remain unverified and incomplete.
- On Node.js 24, the existing 286 unit tests and typecheck pass. Lint passes with five pre-existing warnings. Database and browser tests have not been run; Docker is unavailable on this host.
- The existing application still uses PostgreSQL, Vercel Blob, and a single configured app URL. No D1 migration or W7S deployment is complete.
- A local OpenNext 1.20.17 build with Next.js 16.4.6 succeeded, but this is not a W7S deployment or runtime proof. Its output was about 97 MB, including a 23 MB server handler. Next.js warned that dynamic PDF font filesystem access traces the whole project. W7S packaging, runtime bindings, archive limits, and font access still need verification.
- A separate local Miniflare probe confirmed that a failing D1 batch rolled back its earlier insert and that an R2 `If-None-Match: *` write preserved the first object. This is a platform primitive check, not a test of SignuDoc's signing or audit logic.
- The D1 migrations under `w7s/` cover authentication, rate limits, envelopes, signers, fields, audit, settings, templates, and provider-session tables. Tests apply them in local Miniflare and check selected constraints. Schema parity is not yet fully verified and the migrations are not ready for deployment.
- The application rate limiter and auth factory accept an explicit D1 binding. Local tests cover rate-limit concurrency and failure, setup-context account creation and sign-in using the real SignuDoc auth factory, and rejection of a domain outside the D1 signup policy. No request-scoped binding provider is connected, and complete setup, email verification, signing, and audit workflows still use PostgreSQL. Better Auth's D1 adapter does not support interactive transactions.
- `readSetupState` and `readStoredSettings` accept explicit D1 bindings, with local tests for fresh, unclaimed, and complete setup states and settings decoding. Their default remains PostgreSQL until request-scoped D1 integration is complete.
- `closeSignupUntilSetupFinishes` and `markEmailReady` also accept explicit D1 bindings, with tests that preserve an existing signup rule and refuse stale sender verification. Complete setup and settings updates still require the transaction port.
- `w7s/audit-chain.mjs` prototypes a conditional D1 audit append with compatible hashes and a concurrent append test. It is not connected to the product. In particular, it does not atomically commit an audit entry together with an envelope state change, so it cannot replace the existing transactional signing workflow as written.

## Next Work

Prove the Next.js build on W7S, then replace PostgreSQL transactions and advisory locks with tested D1-compatible coordination. Port private storage, scheduled jobs, authentication and links, and localize the full signing flow before deploying.
