# Going live with real mail

This guide connects NyxMail to real SMTP. It assumes:

- Web origin: `https://mail.example.com`
- Mail domain: `example.com`
- MTA host: `mail.example.com` (A/AAAA `203.0.113.10`)
- MTA: Haraka (recommended for the plugin path) or Postfix for inbound/outbound
- NyxMail at `/opt/nyxmail`, running as an unprivileged `nyxmail` user

> Read the security model in the README first. Inbound external mail and outbound
> external mail are plaintext while the MTA/server processes them. The webhook
> seals inbound mail before persistence; internal and at-rest mail remains
> ciphertext.

## 1. DNS

Publish approximately the following records. TTLs of 300–3600 seconds are fine.

| Name | Type | Value |
| --- | --- | --- |
| `mail.example.com` | A | `203.0.113.10` |
| `mail.example.com` | AAAA | `2001:db8::10` (optional) |
| `example.com` | MX 10 | `mail.example.com` |
| `example.com` | TXT (SPF) | `v=spf1 mx -all` |
| `nyxmail._domainkey.example.com` | TXT (DKIM) | `v=DKIM1; k=rsa; p=MIIBIjAN...` |
| `_dmarc.example.com` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; adkim=s; aspf=s` |
| `10.113.0.203.in-addr.arpa` | PTR | `mail.example.com` |
| `_mta-sts.example.com` | TXT | `v=STSv1; id=20261119000000` |
| `mta-sts.example.com` | A | `203.0.113.10` |

Use a real DKIM key. Add the domain under **Settings → Domains** and leave
**Generate a DKIM key automatically** enabled; NyxMail stores the encrypted
private key and the Domains tab gives you the exact TXT record to publish.

For a legacy file-based key, you can still generate one and add it to the
environment:

```bash
cd /opt/nyxmail
npm run dkim:generate -- example.com
```

The private key is written to `config/dkim/example.com.private` with mode `0600`
and is git-ignored. Point OpenDKIM/your MTA at it, publish the printed TXT
record, and restart web + worker. The Domains tab shows live public-DNS status
and lets you re-check every record.

Start with DMARC `p=none` while validating, then quarantine, then reject. Add
MTA-STS and TLS-RPT when TLS is stable. Set a matching PTR (rDNS) at your VPS
provider or many receivers will penalty-score you.

If outbound mail is relayed through a provider, SPF must authorize that provider:

```
v=spf1 mx include:outbound.provider.example -all
```

## 2. Inbound SMTP and authentication

NyxMail does not implement SMTP itself. Run an MTA on port 25, apply SPF, DKIM and
DMARC validation, add an `Authentication-Results` header, then hand messages to
NyxMail.

### Haraka

```bash
npm install -g Haraka
haraka -i /opt/haraka
cp /opt/nyxmail/docs/haraka/nyxmail_ingest.js /opt/haraka/plugins/
```

`/opt/haraka/config/plugins` (order matters; keep your normal spam plugins too
unless you delegate scanning to the bundled Rspamd sidecar):

```
tls
helo.checks
mail_from.is_resolvable
spf
dkim_verify
dmarc
data.headers
nyxmail_ingest
```

`/opt/haraka/config/host_list`:

```
example.com
```

`/opt/haraka/config/smtp.ini` needs your TLS certificate paths and a normal HELO.
The plugin reads:

```
NYXMAIL_URL=https://mail.example.com
NYXMAIL_INGEST_SECRET=<INGEST_SECRET from .env>
NYXMAIL_WEBHOOK_PATH=/api/v1/ingest
```

Restart Haraka. Its `data_post` hook posts raw MIME to NyxMail. Haraka returns a
temporary 4xx if the webhook is down so senders retry.

Your inbound chain must strip any client-supplied `Authentication-Results`
headers before adding its own. The sample plugin relies on the MTA-inserted
header; if you supply `authResults` in the JSON object, NyxMail trusts that object
instead. Never let external senders define their own SPF/DKIM/DMARC verdicts.

Make sure the webhook is reachable from the MTA and that its HMAC timestamp is
within five minutes (the sample plugin supplies milliseconds). Do not expose the
webhook to arbitrary clients without the secret.

### Postfix alternative

> **Spam scanning:** start the bundled `rspamd` compose service and set
> `RSPAMD_URL` / `RSPAMD_CONTROLLER_URL` in `.env`. NyxMail then scans the raw
> MIME message (including images and attachments) itself on `/checkv2` and stores
> the score, action and every symbol with the message. You can remove duplicate
> content scanners from the MTA, but keep SPF/DKIM/DMARC verification there. When
> Rspamd is stopped, NyxMail falls back to its built-in heuristics.

Use Postfix as MX, with OpenDKIM/OpenDMARC/SPF checks, then a content filter that
POSTs the raw message to the same endpoint. The message must include an
`Authentication-Results` header or you must supply the `authResults` object in
the webhook JSON. A minimal integration is to configure a `content_filter` or
`transport_maps` pipe to a small signed relay; the Haraka plugin is the reference
implementation.

Postfix main settings worth checking:

```
myhostname = mail.example.com
mydomain = example.com
myorigin = $mydomain
inet_interfaces = all
mydestination =
relay_domains = example.com
smtpd_tls_cert_file = /etc/letsencrypt/live/mail.example.com/fullchain.pem
smtpd_tls_key_file  = /etc/letsencrypt/live/mail.example.com/privkey.pem
smtpd_use_tls = yes
smtpd_tls_security_level = may
smtp_tls_security_level = may
smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination
```

`mydestination` must not claim `example.com` if you route it through the webhook;
otherwise Postfix will try local delivery.

## 2b. Additional domains and catch-all

To receive mail for a second domain such as `example.net` and deliver every
unclaimed local part to one mailbox:

1. Add the domain to the MTA. Haraka `config/host_list`:

   ```
   example.com
   example.net
   ```

   For Postfix, add it to `relay_domains` (or the appropriate virtual relay
   configuration) and ensure messages are passed to the NyxMail webhook rather
   than rejected for an unknown local user.

2. Publish DNS for `example.net`:

   | Name | Type | Value |
   | --- | --- | --- |
   | `example.net` | MX 10 | `mail.example.com` |
   | `example.net` | TXT | `v=spf1 mx -all` |
   | `nyxmail._domainkey.example.net` | TXT | your DKIM public key for that domain |
   | `_dmarc.example.net` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.net` |
   | PTR for the MTA IP | PTR | `mail.example.com` |

3. Configure NyxMail:

   ```dotenv
   MAIL_DOMAIN="example.com"
   MAIL_DOMAINS="example.com,example.net"
   SIGNUP_DOMAINS="example.com"
   CATCH_ALL_MAP='{"example.net":"you@example.com"}'
   ```

   The catch-all target must already exist as a local user or active alias.
   Exact aliases such as `support@example.net` override the catch-all.

4. Restart web and worker, reload the MTA, then send to
   `test-random@example.net`.

Catch-all does not create an outbound identity automatically. Add an alias for
any address you want to use in the composer's From selector. Catch-all domains
attract dictionary spam; keep DMARC enforcement and per-user filters enabled.

### Copy-ready DNS and mail filters

After configuring `MAIL_HOSTNAME`, optional A/AAAA addresses, `DKIM_PUBLIC_KEY_MAP` and the
DMARC/SPF overrides, open **Settings → Domains** in NyxMail. Each configured domain shows MX,
SPF, DKIM, DMARC, A/AAAA and PTR guidance with copy buttons and a downloadable zone file.
The relevant environment block is:

```dotenv
MAIL_HOSTNAME="mail.example.com"
MAIL_SERVER_IPV4="203.0.113.10"
MAIL_SERVER_IPV6=""
DKIM_SELECTOR="nyxmail"
DKIM_PUBLIC_KEY_MAP='{"example.com":"MIIBIjAN...","example.net":"MIIBIjAN..."}'
# Optional:
SPF_RECORD="v=spf1 mx -all"
DMARC_POLICY="quarantine"
DMARC_REPORT_EMAIL="dmarc@example.com"
```


In **Settings → Filters**, build ordered Sieve-style rules over the From/To/Cc/Subject/body,
attachments, size, spam score and authentication results. A rule can move mail into a folder,
add labels, mark it read/unread, star, archive, spam or trash it. Each filter can use the
visual editor or **Raw Sieve**; raw scripts are validated, previewed, compiled to the same
conditions/actions, and stored for later editing. Use one `if` block per filter; `redirect`,
`discard`, `vacation` and mixed nested boolean groups are intentionally unsupported. Rules
apply to inbound internet mail; historical imports and end-to-end-encrypted local traffic
are not re-filtered.

## 2d. Proton Mail and Gmail imports

- **Proton Mail export (no Bridge):** use Proton's Export Tool, zip the
  `mail_*` folder (including `labels.json` and `.metadata.json` sidecars), and
  upload it under **Settings → Imports → Proton export folder (ZIP)**. The worker
  reconstructs folders, labels, read/starred state and encrypts each message.
  Uploads are capped at 2GB by NyxMail and possibly lower by a reverse proxy.
- **Proton Mail via Bridge:** alternatively run Proton Bridge near the NyxMail
  worker, open **Settings → Imports → Proton Mail via Bridge**, and enter the
  Bridge IMAP host/port, Proton address and generated Bridge password. Keep
  Bridge on loopback or a trusted private network; never publish its IMAP port.
- **Gmail:** enable the Gmail API in Google Cloud, add
  `https://www.googleapis.com/auth/gmail.readonly` on the OAuth consent screen's
  Data Access page (use “Manually add scopes” if it is not in the picker), create
  a Web application OAuth client, add
  `https://mail.example.net/api/v1/imports/gmail/callback` as an authorized
  redirect URI, and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
  `GOOGLE_REDIRECT_URI`. The `openid`/`email` OIDC scopes are not needed and do
  not appear in the consent-screen scope picker. This is import-only; NyxMail
  login remains password + TOTP. Restart web and worker after changing the
  environment.

## 3. Outbound SMTP

Configure the NyxMail web/worker `.env`:

```
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=nyxmail-submission
SMTP_PASSWORD=<secret>
SMTP_FROM=NyxMail <no-reply@example.com>
```

Submit through an authenticated Postfix/Haraka listener (587 + STARTTLS or 465
implicit TLS). Sign DKIM at the MTA. If you use a provider, use its submission
credentials and add its SPF include.

Important: outbound external recipients receive ordinary SMTP. NyxMail cannot
end-to-end encrypt to arbitrary third-party mailboxes without a key exchange or
password-protected message links. Internal recipients are delivered directly
with sealed ciphertext and never traverse SMTP.

## 4. Web, worker and filesystem

Create the database and run migrations:

```bash
cd /opt/nyxmail
sudo -u nyxmail cp .env.example .env
sudo -u nyxmail npm ci
sudo -u nyxmail npm run db:generate
sudo -u nyxmail npm run db:migrate
sudo -u nyxmail npm run build
```

If you prefer containers, [`docker-compose.selfhost.yml`](../docker-compose.selfhost.yml)
runs the web process, worker, PostgreSQL and Redis. Apply migrations once with
`docker compose -f docker-compose.selfhost.yml run --rm web npm run db:migrate`,
then put your TLS reverse proxy in front of port 3000.

Systemd examples:

```ini
# /etc/systemd/system/nyxmail-web.service
[Unit]
Description=NyxMail web
After=network.target postgresql.service

[Service]
Type=simple
User=nyxmail
WorkingDirectory=/opt/nyxmail
EnvironmentFile=/opt/nyxmail/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nyxmail/uploads
[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/nyxmail-worker.service
[Unit]
Description=NyxMail worker
After=network.target postgresql.service nyxmail-web.service

[Service]
Type=simple
User=nyxmail
WorkingDirectory=/opt/nyxmail
EnvironmentFile=/opt/nyxmail/.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nyxmail/uploads
[Install]
WantedBy=multi-user.target
```

Put nginx in front using [`docs/nginx-nyxmail.conf`](nginx-nyxmail.conf), or a
Caddy equivalent. Set:

```
APP_URL=https://mail.example.com
TRUST_PROXY=true
NODE_ENV=production
UPLOAD_DIR=/opt/nyxmail/uploads
REDIS_URL=redis://127.0.0.1:6379
```

Set `TRUST_PROXY=true` only if nginx is the direct, trusted peer. Restrict
PostgreSQL/Redis to localhost or a private network. The worker must not be
publicly exposed.

## 5. Backups

Back up together:

- `pg_dump` (or a physical backup) of the NyxMail database.
- The `UPLOAD_DIR` volume (encrypted attachments and import files).
- `.env` secrets (in a password manager / sealed secret store).
- DNS zone configuration and MTA DKIM keys.

An encrypted database backup is not readable without user keys, but losing the
database loses the mailbox. Test restores on a staging host. Do not back up
plaintext message data anywhere; NyxMail never creates it at rest.

Example:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=/backups/nyxmail-$(date +%F).dump
tar -C /opt/nyxmail -czf /backups/uploads-$(date +%F).tar.gz uploads
```

Encrypt the backup archive with age/GPG and store it off-host.

## 6. Operations checklist

- [ ] HTTPS redirects and a valid certificate; `APP_URL` matches exactly.
- [ ] `JWT_SECRET`, `APP_ENCRYPTION_KEY`, `RECOVERY_PEPPER`, `INGEST_SECRET` are
  random and unique; `.env` is not world-readable.
- [ ] Signup domain restriction matches the MX domain.
- [ ] SPF, DKIM and DMARC pass for a test outbound message.
- [ ] `Authentication-Results` contains pass verdicts for a test inbound message.
- [ ] Ingest HMAC rejects bad signatures and stale timestamps.
- [ ] Worker is running: imports, scheduled sends, trash purge, snooze wake-up.
- [ ] Trash retention is 30 days; check the worker logs for purge errors.
- [ ] Backups and restore drill pass.
- [ ] `REDIS_URL` configured if more than one web replica.
- [ ] Rate limits tuned for your user count; auth endpoints are strict by default.
- [ ] Disk quota alarms on `UPLOAD_DIR`; orphan cleanup scheduled if necessary.
- [ ] Logs do not contain message plaintext (NyxMail only logs metadata/errors).
- [ ] Browser notifications are optional and permission-gated.
- [ ] Recovery kit flow has been tested with a staging account.
- [ ] Passkey registration works on the public HTTPS origin.
- [ ] CSP has no console violations; remote images load only through the proxy.

## 7. Known operational boundaries

- External mail is relayed through ordinary SMTP and is not end-to-end encrypted
  for external recipients. Internal mail is.
- Bounce/DSN generation is delegated to the MTA. NyxMail records transport
  failures in `TransportLog` but does not synthesize DSNs.
- Group addresses, mailing lists and calendar invitations are not implemented.
- Attachment filenames and envelope metadata are visible to the server by design.
- Search covers up to 5,000 recent messages per browser index build.
- One worker handles one import job at a time. Multiple workers are safe but not
  necessary for small deployments.
- Web push (service worker + VAPID) is not implemented; in-app and local browser
  notifications are available while a tab is connected to the SSE stream.
