# SignuDoc Runbook

## Restore

```bash
git clone git@github.com:omattic/signudoc.git ~/signudoc
cd ~/signudoc
git remote add upstream git@github.com:NYLLON-SOFTWARE/SignuDoc.git
git config remote.pushDefault origin
```

Bind the existing `signudoc` Telegram topic to `/home/gnu/signudoc` through the manager.

## Development

Follow `README.md`, `CONTRIBUTING.md`, and `docs/self-hosting.md`. The package requires Node.js 24.x. After reviewing configuration, install with `npm ci`. Existing checks include `npm run lint`, `npm run typecheck`, and `npm test`. Database and browser tests require their documented dependencies. Docker is not installed on this host, so use an isolated PostgreSQL instance to run the existing database tests.

The root `CNAME` lists the two planned W7S domains. It does not itself set DNS or provision HTTPS. The existing application is not yet compatible with D1 or ready for W7S deployment.

Run `npm run test:d1` on Node.js 24 to exercise the prototype D1 schema, rate-limit integration, and SignuDoc auth factory against local Miniflare. The migrations in `w7s/migrations/` are not production-ready and must not be deployed until schema parity and the complete application workflows are verified.

## Completion

Inspect changes, run checks appropriate to the task, commit scoped files, and push to `origin/main`. Never push to `upstream`. Do not assume production hosting or secrets are configured.
