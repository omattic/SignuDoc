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

Follow `README.md`, `CONTRIBUTING.md`, and `docs/self-hosting.md`. The package requires Node.js 24.x. After reviewing configuration, install with `npm ci`. Existing checks include `npm run lint`, `npm run typecheck`, and `npm test`. Database and browser tests require their documented dependencies. No application checks were run during registration.

## Completion

Inspect changes, run checks appropriate to the task, commit scoped files, and push to `origin/main`. Never push to `upstream`. Do not assume production hosting or secrets are configured.
