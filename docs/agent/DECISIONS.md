# SignuDoc Decisions

## 2026-11-16: Private Omattic Copy

Keep the original history and license in a private `omattic/signudoc` repository. Retain an upstream remote for explicit future updates; Omattic changes are pushed to origin only. No hosting decision is made by workspace registration.

## 2026-11-16: W7S migration direction

The project is new, with no existing data or clients to migrate. Target W7S with a fresh D1 database and private R2 document storage. Use one codebase and deployment for `firmar-documento.com` (Spanish) and `document-signature.com` (English), with a shared application database. The `CNAME` file declares both hostnames, but it does not configure DNS or prove that either domain is live.

PostgreSQL transactions and advisory locks protect signing and audit operations. Replace and test those guarantees explicitly during the D1 port; a SQL syntax conversion alone is insufficient. Authentication, generated links, emails, and PDF content must preserve the intended language and domain. Cookies cannot be shared across these unrelated domains.

The requested replacement is the PostgreSQL database layer, not a rewrite of the SignuDoc application. Keep the existing product and its signing and audit guarantees while porting database-dependent behavior.

## 2026-11-17: Native Worker and React migration

Replace Next.js and OpenNext with a React frontend and native W7S Worker backend. Preserve the existing application as the functional reference during the port, including signing, audit integrity, authentication, private document storage, and both language domains. The prototype Worker is isolated from deployment until full workflows and their security guarantees are verified.
