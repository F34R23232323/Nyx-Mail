# NyxMail Mobile

The native Android client for [NyxMail](../README.md) — a zero-access, end-to-end
encrypted mailbox. Built with React Native and Expo, **100% native mobile
components** (no WebView, no embedded browser), and byte-compatible with the
NyxMail web client's libsodium encryption formats.

![NyxMail](assets/icon.png)

## Screens

| Inbox | Conversation | Private search |
| --- | --- | --- |
| ![Inbox](docs/screenshots/inbox.webp) | ![Conversation](docs/screenshots/conversation.webp) | ![Search](docs/screenshots/search.webp) |

| Security | Theme |
| --- | --- |
| ![Security](docs/screenshots/security.webp) | ![Appearance](docs/screenshots/appearance.webp) |

## What is included

**Authentication**
- Password sign-in against any NyxMail server, with a configurable server address.
- TOTP two-factor and single-use backup codes.
- Full in-app signup: X25519 key generation, Argon2id key envelope, 24-word
  BIP-39 recovery kit, TOTP enrollment and backup-code handoff.
- Automatic private-key unlock after 2FA; separate unlock screen when the app is
  reopened or after 5 minutes in the background.
- Session refresh, CSRF handling, session revocation and remote device list.

**Mail**
- Encrypted inbox with folder chips, label filters, unread counts and infinite
  pagination.
- Threaded conversations with expandable message cards and SPF/DKIM/DMARC badges.
- Reply, reply-all and forward with quoted history.
- Compose sheet with From aliases, To/Cc/Bcc chips, contact suggestions,
  encrypted attachments (up to 25 MB) and scheduled send.
- Encrypted draft autosave every five seconds.
- Swipe to archive or delete, long-press multi-select, bulk read/star/archive/trash.
- Private on-device search index over up to 600 decrypted messages.
- Contacts with edit, delete and one-tap compose.
- Remote images blocked by default; HTML email rendered with native components.
- Attachment decryption on demand and native Android share sheet.

**Settings**
- Account profile, signature, recovery email and storage usage.
- Dark “Onyx” / light “Daylight” themes.
- Key fingerprint, key-derivation details and lock-now.
- Active session list with per-device revocation.
- Folder, label and alias management.
- Two-factor and passkey status with links to the web app for advanced changes.

## Architecture

```
mobile/
├── App.tsx                    providers + font boot + splash
├── src/
│   ├── components/            native design system (buttons, sheets, rows, toast)
│   │   ├── auth/              OTP input, backup codes overlay
│   │   ├── mail/              mail row, HTML email body
│   │   └── ui/                AppText, Avatar, Chip, Screen, SwipeableRow…
│   ├── compose/               global compose sheet provider
│   ├── hooks/useMailList.ts   paginated, decrypted thread list
│   ├── lib/
│   │   ├── api.ts             fetch client, CSRF, refresh, upload/download
│   │   ├── auth.tsx           session + key unlock state machine
│   │   ├── crypto.ts          Argon2id, X25519 sealed boxes, secretbox, XChaCha
│   │   ├── mail.ts            message sealing/decryption, attachments
│   │   ├── mail-data.tsx      folders/labels/aliases/contacts/unread context
│   │   └── mailBus.ts         mailbox change events
│   ├── navigation/            root stack + custom floating tab bar
│   ├── screens/               auth, mail, search, contacts, settings
│   └── theme/                 Onyx/Daylight palettes and tokens
├── android/                   generated native project (release-signed)
├── credentials/               local release keystore + test credentials (ignored)
└── scripts/                   crypto compatibility check, icon and test seed scripts
```

### Cryptography

Hermes has no WebAssembly, so `libsodium-wrappers-sumo` cannot run on device.
The mobile client implements the exact same wire formats using audited pure-JS
libraries:

| Operation | Web (libsodium) | Mobile |
| --- | --- | --- |
| Argon2id KDF | `crypto_pwhash` (2 ops, 64 MiB) | native `argon2kt` on Android; Noble Argon2id v1.3 fallback |
| Subject/body/key bundle | `crypto_secretbox` | TweetNaCl `secretbox` |
| Recipient key wrapping | `crypto_box_seal` | TweetNaCl box + BLAKE2b nonce |
| Attachment AEAD | XChaCha20-Poly1305 IETF | `@noble/ciphers` |
| Randomness | libsodium | `expo-crypto` CSPRNG |

`npm run test:crypto` cross-checks every format in both directions against the
web client's libsodium implementation.

Argon2id at 64 MiB is intentionally expensive. Pure JavaScript would take close
to a minute on a phone, so release builds use the native `argon2kt` binding from
`react-native-argon2` (patched for AGP 8 by `scripts/patch-argon2.mjs`) and fall
back to the audited Noble implementation in Expo Go, tests and web builds.

## Run against a NyxMail server

The app has no baked-in production server. Enter the address from the pill on the
login screen, or set it at bundle time:

```bash
cd mobile
npm install
EXPO_PUBLIC_NYXMAIL_URL="https://mail.example.com" npx expo start
```

When `EXPO_PUBLIC_NYXMAIL_URL` is empty, the login screen asks for a server
address and saves it on the device. Production servers must use HTTPS.

Scan the QR with Expo Go for UI work, or run `npm run android` for a native build.

## Build the Android APK

Requirements: Node 20+, JDK 17, Android SDK (platform 36, build-tools 36, NDK
27.1). Set `ANDROID_HOME` or install the SDK at `~/android-sdk`. Before publishing
your own build, change `expo.android.package` and `expo.ios.bundleIdentifier` in
`app.json` to identifiers you control.

```bash
cd mobile
npm install
npx expo prebuild --platform android --clean   # regenerate android/ if needed
npm run android:prepare                        # re-apply signing + cleartext config
npm run apk:release
```

The signed APK is written to
`mobile/android/app/build/outputs/apk/release/app-release.apk`. Release artifacts
are not committed to the repository.

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Release signing uses `credentials/nyxmail-release.keystore` and
`credentials/keystore.properties` (generated by `npm run android:keystore`).
Back these up: Play Store updates require the same key. The `credentials/`
directory and all APK/AAB files are git-ignored; never commit them.

For a debug build with Metro:

```bash
npm run android
```

### Android networking

- HTTPS is required by default (network security config).
- Cleartext is allowed only for emulator loopback hosts `10.0.2.2`,
  `10.0.3.2`, `localhost` and `127.0.0.1`, so a self-hosted development server
  can be reached without weakening production traffic.

## Local test mailbox

A local test environment is optional but useful for development. It never touches
the production database.

```bash
# 1. Create a throwaway database
createdb nyxmail_mobile_test
DATABASE_URL="postgresql://nyxmail:nyxmail@localhost:5432/nyxmail_mobile_test" \
  npx prisma migrate deploy --schema db/prisma/schema.prisma

# 2. Run the web/API server on port 3100 with the test DB
cd /path/to/nyxmail
DATABASE_URL="postgresql://nyxmail:nyxmail@localhost:5432/nyxmail_mobile_test" \
APP_URL="http://10.0.2.2:3100" MAIL_DOMAIN="example.com" \
SIGNUP_DOMAINS="example.com" OUTBOUND_TRANSPORT=console \
PORT=3100 npm run dev --workspace web

# 3. Seed a complete encrypted mailbox
DATABASE_URL="postgresql://nyxmail:nyxmail@localhost:5432/nyxmail_mobile_test" \
NYX_TEST_API="http://localhost:3100" npx tsx mobile/scripts/seed-test-account.ts
```

Then set the app server to `http://10.0.2.2:3100` (Android emulator) or
`http://localhost:3100` via `adb reverse tcp:3100 tcp:3100`. Credentials are
written to `mobile/credentials/test-account-full.txt` (git-ignored). The default test
login is `mobile@example.com` with password `NyxMail!2025`; override it with
`NYX_TEST_EMAIL` / `NYX_TEST_PASSWORD`.

The seed creates 12 messages across eight threads, labels, contacts, an archived
conversation, a sent reply, an encrypted draft, a trashed promo and a real
encrypted attachment.

## Performance notes

- Session user metadata is cached locally so the unlock screen appears before a
  network session check. The session is still validated in the background.
- Inbox pages are decrypted in one parallel batch and cached in memory; avatars
  are loaded lazily and cached on disk so scrolling back does not refetch them.
- Release builds import only the Feather icon set and only the five Inter weights
  actually used, reducing the APK by roughly 9 MB.
- Search indexes the 400 most recent messages on demand instead of the entire
  mailbox. The index is memory-only and rebuilt after a cold start.
- Email HTML rendering is memoized per message, and list windows are batched to
  keep scrolling responsive on lower-end devices.

## Operational notes

- The unread badge and inbox refresh by polling while the app is open. Push
  notifications require project-specific FCM credentials, so this build keeps
  them deployer-configurable rather than shipping a shared push key.
- Passkeys, recovery-phrase rotation, backup-code regeneration and account email
  changes remain available in the web app. The native client shows their status
  and links to the web settings.
- Decrypted search is in-memory only. It is rebuilt after a cold start.

## Gmail sending

The From menu includes connected Gmail accounts. Selecting one sends external
recipients through the Gmail API; Google signs and delivers that copy, so it is
outside NyxMail's end-to-end encryption. NyxMail still writes an encrypted Sent
copy and delivers internal NyxMail recipients through the encrypted local path.

Google requires a one-time reauthorization before an import-only Gmail connection
can send. In the composer, open **From → Reconnect Gmail / add another**, approve
`gmail.send`, then return to the app. The server must also be running the updated
Gmail endpoints and have `gmail.send` listed on the Google OAuth consent screen.

## Security notes

- The decrypted private key lives in React memory only. It is never written to
  AsyncStorage, SecureStore or disk, and is cleared when the app backgrounds for
  more than five minutes.
- The password is held in memory only during the login → 2FA → unlock sequence.
- The on-device search index contains decrypted message text in memory. It is not
  persisted to disk by this client.
- Remote images are blocked until you explicitly load them for a message; doing so
  reveals your IP to the image host, exactly as a normal native mail reader would.
- The app ships no analytics, crash reporting, ad SDKs or third-party trackers.
- APK release builds are minified, signed, `allowBackup=false`, and use a network
  security config that requires TLS outside local development.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript checks |
| `npm run test:crypto` | Cross-check crypto against libsodium |
| `npm run apk:release` | Build a signed release APK |
| `npm run android:prepare` | Apply signing/network config after prebuild |
| `npm run android:keystore` | Generate a new release keystore |
| `npm run seed:test` | Seed the local test mailbox |

## License

MIT — same as NyxMail.
