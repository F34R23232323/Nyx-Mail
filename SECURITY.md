# Security policy

## Supported versions

NyxMail is early-stage software. Security fixes are applied to the latest commit
on `main`; there are no maintained release branches yet. Always deploy the latest
tagged or `main` build.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

1. Open the repository on GitHub.
2. Go to **Security → Advisories → Report a vulnerability**.
3. Include affected version/commit, deployment shape, reproduction steps, and
   the impact you believe is possible.

Maintainers: enable **Private vulnerability reporting** under
**Settings → Code security** so this link works on your repository.

If private advisories are unavailable, contact the maintainers listed in the
repository profile. Please allow a reasonable window for a fix before public
disclosure.

We aim to acknowledge reports within a few business days. This is a
volunteer-maintained project and no bug bounty is offered.

## In scope

- Authentication, session refresh, CSRF and WebAuthn flows.
- Client-side key handling, ciphertext envelope formats, recovery kit, TOTP.
- Ingest webhook authentication, replay protection and mime handling.
- XSS/HTML sanitisation, remote image proxy and SSRF protections.
- IDOR, cross-mailbox access, upload path traversal and quota bypass.
- Import adapters (Gmail, IMAP, Proton Bridge/export, mbox/EML).
- Secret storage, logging of plaintext or credentials, and default configs that
  are unsafe when self-hosted.

## Out of scope

- A malicious server serving modified client JavaScript. The zero-access model
  protects data at rest and honest-but-curious hosting, not a hostile web host.
- A compromised browser, operating system, extension or mail client.
- Missing hardening on an intentionally misconfigured deployment (for example
  exposing PostgreSQL or the worker to the internet).
- Denial of service through resource exhaustion on an unfiltered public endpoint.
- Social engineering and physical device access.

## Deployment hardening

- Generate fresh values for `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `RECOVERY_PEPPER`
  and `INGEST_SECRET`; never reuse the examples.
- Terminate TLS before the web app and set `APP_URL` to the exact HTTPS origin.
- Keep PostgreSQL, Redis, Rspamd and the worker off the public network.
- Set `TRUST_PROXY=true` only behind a proxy you control.
- Back up the database and `uploads` volume together and test restores.
- Treat the browser profile and recovery kit as part of the secret material.

## No audit

NyxMail has not undergone an independent security audit. Read the threat model in
the README and arrange your own review before trusting it with sensitive mail.
