# Contributing to NyxMail

Thanks for helping. NyxMail is a self-hosted, privacy-focused mail application, so
changes that touch authentication, cryptography, mail parsing or ingress need extra
care.

## Before you start

- Search existing issues and pull requests.
- For a security issue, follow [SECURITY.md](SECURITY.md). Do not open a public
  issue.
- For a large feature, open an issue first so the design can be discussed.

## Local setup

Requirements: Node.js ≥ 20.11, npm ≥ 10 and PostgreSQL ≥ 15. Docker is optional.

```bash
git clone https://github.com/your-org/nyxmail.git
cd nyxmail
cp .env.example .env
npm run keys:secrets          # paste the generated secrets into .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run db:seed               # optional demo mailbox
npm run dev                   # http://localhost:3000
npm run dev:worker            # second terminal
```

The app and worker read the repository-root `.env`. For browser crypto, use
`https://` or `localhost`. Uploads are written under `UPLOAD_DIR`.

### Mobile

The React Native client is a separate npm project:

```bash
cd mobile
npm install
npm run typecheck
npm run test:crypto
```

The `test:crypto` script resolves `libsodium-wrappers-sumo` from the repository
root, so run `npm install` at the root first. See [`mobile/README.md`](mobile/README.md)
for native builds and signing.

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
cd mobile && npm run typecheck && npm run test:crypto
```

The Playwright suite is optional locally and needs a migrated database and demo
mailbox:

```bash
npm run db:migrate
npm run db:seed
npm run test:e2e
```

If you change the Prisma schema, create a checked-in migration:

```bash
npm run db:migrate:dev -- --name describe_the_change
```

## Code style

- TypeScript, strict mode, two-space indentation, existing formatting conventions.
- Keep server/client boundaries explicit. Never import server-only secrets into a
  client component.
- Prefer the existing `@nyxmail/*` packages over duplicating logic.
- Add tests for parser, rule, crypto or protocol changes.
- Do not add telemetry, analytics, third-party trackers or remote fonts.
- Keep error messages useful but free of message content and secrets.

## Security-sensitive changes

Call out changes to:

- `crypto/`, key envelopes, recovery kits or attachment AEAD.
- `web/src/lib/auth.ts`, session cookies, CSRF or WebAuthn.
- `web/src/app/api/v1/ingest/` and the HMAC contract.
- HTML sanitisation, the image proxy, SSRF checks and upload paths.
- Import adapters and anything that writes user-controlled paths.

Include a short threat-model note in the pull request and add regression tests
where possible.

## Never commit

- `.env` files, database dumps, `uploads/`, mail archives or exported mailboxes.
- DKIM private keys (`config/dkim/`).
- Mobile signing keys or `mobile/credentials/`.
- APK/AAB/IPA artifacts.
- Real email addresses, server IPs or credentials in tests, screenshots or docs.

Use example domains (`example.com`, `example.net`) and the demo seed for
screenshots. If a secret is accidentally committed, rotate it immediately and tell
the maintainers privately.

## Pull requests

- Keep changes focused and explain the user-visible effect.
- Include screenshots for UI changes, with test data only.
- Update the README or docs when behaviour or configuration changes.
- Make sure CI is green.
- By contributing, you agree that your contribution is licensed under the MIT
  license used by this repository.
