/**
 * Seeds a fully functional demo mailbox.
 *
 * Login:   demo@localhost
 * Password: NyxMail!2025
 * TOTP:     JBSWY3DPEHPK3PXP (or `npm run demo:totp`)
 *
 * All sample message bodies are encrypted to the demo user's public key
 * before they are written to Postgres. The seed prints the recovery phrase
 * and one-time backup codes at the end.
 */
import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createKeyEnvelope,
  createRecoveryKit,
  generateBackupCodes,
  generateKeyBundle,
  ready,
} from "@nyxmail/crypto";
import { encryptInboundAttachment, sealInboundMessage } from "@nyxmail/crypto/server";
import { encryptSecret, hashRecoveryPhrase } from "@nyxmail/shared/secrets";
import { writeUpload } from "@nyxmail/shared/storage";

config({ path: resolve(process.cwd(), "../.env") });
config({ path: resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@localhost";
const DEMO_PASSWORD = "NyxMail!2025";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

interface DraftMessage {
  from: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  hoursAgo: number;
  read?: boolean;
  starred?: boolean;
  labels?: string[];
  to?: string[];
  attachment?: { filename: string; mimeType: string; content: string };
}

interface DraftThread {
  folder: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM";
  messages: DraftMessage[];
}

const threads: DraftThread[] = [
  {
    folder: "INBOX",
    messages: [
      {
        from: "NyxMail Team",
        fromName: "NyxMail Team",
        subject: "Welcome to NyxMail",
        hoursAgo: 2,
        read: false,
        starred: true,
        labels: ["Product"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
          <h2 style="margin:0 0 12px">Your private inbox is ready</h2>
          <p>Welcome to NyxMail. Everything in this mailbox — subjects, bodies and attachments — is encrypted <em>before</em> it reaches the server.</p>
          <ul>
            <li>Your 24-word recovery kit is the only way back in if you forget your password.</li>
            <li>Two-factor authentication is always required at sign-in.</li>
            <li>Remote images stay blocked until you explicitly trust a sender.</li>
          </ul>
          <p style="margin-top:24px">Try the keyboard shortcut <kbd>?</kbd> to see everything you can do without a mouse.</p>
          <p>— The NyxMail team</p>
        </div>`,
        text: "Welcome to NyxMail. Everything in this mailbox is encrypted before it reaches the server. Your recovery kit is essential. Two-factor authentication is always required. Press ? to see keyboard shortcuts.",
      },
      {
        from: "Ada Lovelace",
        fromName: "Ada Lovelace",
        subject: "Re: Welcome to NyxMail",
        hoursAgo: 1,
        read: false,
        labels: ["Product"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
          <p>Lovely to see a mail service that takes the hard problems seriously.</p>
          <blockquote style="border-left:3px solid #6D4AFF;margin:16px 0;padding-left:12px;color:#666">
            Your private inbox is ready. Everything is encrypted before it reaches the server.
          </blockquote>
          <p>Is there a way to import my old archive?</p>
        </div>`,
        text: "Lovely to see a mail service that takes the hard problems seriously.\n\nQuoted: Your private inbox is ready.\n\nIs there a way to import my old archive?",
      },
    ],
  },
  {
    folder: "INBOX",
    messages: [
      {
        from: "Margaret Hamilton",
        fromName: "Margaret Hamilton",
        subject: "Launch checklist for Friday",
        hoursAgo: 26,
        read: true,
        labels: ["Work"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
          <p>I went through the checklist this morning. Two things remain:</p>
          <ol><li>Confirm the final MX cutover window.</li><li>Rotate the ingest webhook secret.</li></ol>
          <p>The team appendix is attached for the ops review.</p>
          <p>Margaret</p>
        </div>`,
        text: "I went through the checklist this morning. Two things remain: confirm the final MX cutover window and rotate the ingest webhook secret. The team appendix is attached.",
        attachment: {
          filename: "launch-checklist.txt",
          mimeType: "text/plain",
          content:
            "NYXMAIL LAUNCH CHECKLIST\n\n[ ] MX cutover window\n[ ] Rotate ingest secret\n[ ] Verify SPF/DKIM/DMARC\n[ ] Run restore drill\n",
        },
      },
    ],
  },
  {
    folder: "INBOX",
    messages: [
      {
        from: "Grace Hopper",
        fromName: "Grace Hopper",
        subject: "The remarkable thing about backups",
        hoursAgo: 50,
        read: true,
        labels: ["Reading"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
          <p>The remarkable thing about backups is that the only ones that count are the ones you have restored.</p>
          <p>Have you tested the encrypted export path yet?</p>
          <blockquote style="border-left:3px solid #444;padding-left:12px;color:#888">If you can't decrypt it offline, you don't own it.</blockquote>
          <p>— Grace</p>
        </div>`,
        text: "The remarkable thing about backups is that the only ones that count are the ones you have restored. Have you tested the encrypted export path yet?",
      },
    ],
  },
  {
    folder: "SENT",
    messages: [
      {
        from: DEMO_EMAIL,
        fromName: "Demo User",
        subject: "Notes from the privacy review",
        hoursAgo: 8,
        read: true,
        to: ["margaret@example.com"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
          <p>Hi Margaret,</p>
          <p>Attaching my notes below. Short version: the key hierarchy looks solid, and the only metadata the server sees is envelope data and sizes.</p>
          <p>One follow-up: we should document the MTA bridge more visibly.</p>
        </div>`,
        text: "Hi Margaret, attaching my notes below. Short version: the key hierarchy looks solid. One follow-up: document the MTA bridge more visibly.",
      },
      {
        from: DEMO_EMAIL,
        fromName: "Demo User",
        subject: "Re: Welcome to NyxMail",
        hoursAgo: 1,
        read: true,
        to: ["ada@example.com"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6"><p>Yes — Settings → Imports handles Gmail, IMAP, mbox and .eml files. You can pause and resume at any time.</p></div>`,
        text: "Yes — Settings → Imports handles Gmail, IMAP, mbox and .eml files. You can pause and resume at any time.",
      },
    ],
  },
  {
    folder: "ARCHIVE",
    messages: [
      {
        from: "Security Desk",
        fromName: "Security Desk",
        subject: "Security key rotation completed",
        hoursAgo: 240,
        read: true,
        labels: ["Work", "Product"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6"><p>This is a confirmation that the quarterly TLS and DKIM rotation completed successfully.</p><p>No action is required.</p></div>`,
        text: "This is a confirmation that the quarterly TLS and DKIM rotation completed successfully. No action is required.",
      },
    ],
  },
  {
    folder: "SPAM",
    messages: [
      {
        from: "Lucky Prize Department",
        fromName: "Lucky Prize Department",
        subject: "FINAL NOTICE: claim your encrypted jackpot",
        hoursAgo: 120,
        read: false,
        html: `<div style="font-family:Arial,sans-serif"><p>Congratulations!</p><p>You have been selected for a <b>once-in-a-lifetime</b> prize. Send your seed phrase to claim it immediately.</p><p><a href="https://example.com/claim">Claim now</a></p></div>`,
        text: "Congratulations! You have been selected for a once-in-a-lifetime prize. Send your seed phrase to claim it immediately.",
      },
    ],
  },
  {
    folder: "DRAFTS",
    messages: [
      {
        from: DEMO_EMAIL,
        fromName: "Demo User",
        subject: "Draft: architecture notes",
        hoursAgo: 4,
        read: true,
        to: ["team@example.com"],
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6"><p>Rough notes on the MTA integration…</p><ul><li>Haraka receives SMTP</li><li>Plugin posts signed MIME to /api/v1/ingest</li><li>Server seals to recipient public key</li></ul></div>`,
        text: "Rough notes on the MTA integration…",
      },
    ],
  },
];

function messageHtml(subject: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif"><p>${subject}</p></div>`;
}

async function main() {
  await ready();
  console.log("Seeding NyxMail demo…");

  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  await prisma.alias.deleteMany({ where: { address: { in: ["hello@localhost", "alias@localhost"] } } });

  const bundle = await generateKeyBundle();
  const passwordEnvelope = await createKeyEnvelope(bundle, DEMO_PASSWORD);
  const recoveryKit = await createRecoveryKit(bundle);
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const backupCodes = await generateBackupCodes(10);

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      displayName: "Demo User",
      isAdmin: true,
      passwordHash,
      argonSalt: passwordEnvelope.argonSalt,
      recoverySalt: recoveryKit.argonSalt,
      encryptedPrivateKey: passwordEnvelope.encryptedPrivateKey,
      recoveryEncryptedPrivateKey: recoveryKit.encryptedPrivateKey,
      recoveryKeyHash: hashRecoveryPhrase(recoveryKit.phrase),
      publicKey: bundle.publicKey,
      signingPublicKey: bundle.signingPublicKey,
      totpSecretEncrypted: encryptSecret(DEMO_TOTP_SECRET),
      totpEnabled: true,
      backupCodes: backupCodes.hashes as Prisma.InputJsonValue,
      recoveryEmail: "recovery@example.com",
      signatureText: "Demo User\nNyxMail — private by construction",
      signatureHtml:
        '<p style="color:#8B93A7;font-size:13px">Demo User · NyxMail — private by construction</p>',
    },
  });

  await prisma.alias.createMany({
    data: [
      { userId: user.id, address: "hello@localhost" },
      { userId: user.id, address: "alias@localhost" },
    ],
  });

  const folderSpecs: Array<{ name: string; type: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "SPAM" | "TRASH" | "CUSTOM"; order: number }> = [
    { name: "Inbox", type: "INBOX", order: 0 },
    { name: "Sent", type: "SENT", order: 1 },
    { name: "Drafts", type: "DRAFTS", order: 2 },
    { name: "Archive", type: "ARCHIVE", order: 3 },
    { name: "Spam", type: "SPAM", order: 4 },
    { name: "Trash", type: "TRASH", order: 5 },
    { name: "Travel", type: "CUSTOM", order: 6 },
  ];
  const folders: Record<string, string> = {};
  for (const spec of folderSpecs) {
    const folder = await prisma.folder.create({ data: { userId: user.id, ...spec } });
    folders[spec.type === "CUSTOM" ? spec.name : spec.type] = folder.id;
  }
  const labelSpecs = [
    { name: "Work", color: "#6D4AFF" },
    { name: "Product", color: "#22C55E" },
    { name: "Reading", color: "#F59E0B" },
  ];
  const labels: Record<string, string> = {};
  for (const spec of labelSpecs) {
    const label = await prisma.label.create({ data: { userId: user.id, ...spec } });
    labels[spec.name] = label.id;
  }

  await prisma.contact.createMany({
    data: [
      { userId: user.id, name: "Ada Lovelace", email: "ada@example.com", dedupeKey: "ada@example.com" },
      { userId: user.id, name: "Grace Hopper", email: "grace@example.com", dedupeKey: "grace@example.com" },
      { userId: user.id, name: "Margaret Hamilton", email: "margaret@example.com", dedupeKey: "margaret@example.com" },
      { userId: user.id, name: "NyxMail Team", email: "team@example.com", dedupeKey: "team@example.com" },
    ],
  });

  let storageUsed = 0;
  let messageCounter = 0;

  for (const thread of threads) {
    const latest = thread.messages[thread.messages.length - 1];
    let threadRecord: { id: string; subjectPreview: string } | null = null;

    for (const source of thread.messages) {
      messageCounter += 1;
      const fromEmail =
        source.from === "NyxMail Team"
          ? `team@${process.env.MAIL_DOMAIN || "localhost"}`
          : source.from === "Security Desk"
            ? `security@${process.env.MAIL_DOMAIN || "localhost"}`
            : source.from === "Lucky Prize Department"
              ? "prize@spam.example"
              : source.from === "Ada Lovelace"
                ? "ada@example.com"
                : source.from === "Grace Hopper"
                  ? "grace@example.com"
                  : source.from === "Margaret Hamilton"
                    ? "margaret@example.com"
                    : source.from;
      const sentAt = new Date(Date.now() - source.hoursAgo * 3600_000);

      interface SeedAttachment {
        blobId: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        contentId: string | null;
        inline: boolean;
        key: string;
        sealedKey: string;
        storagePath: string;
        bytes: Buffer;
      }
      let attachment: SeedAttachment | null = null;

      if (source.attachment) {
        const blobId = randomUUID();
        const bytes = Buffer.from(source.attachment.content, "utf8");
        const encrypted = await encryptInboundAttachment(bytes, user.publicKey);
        const storagePath = `${user.id}/${blobId}.bin`;
        await writeUpload(storagePath, encrypted.ciphertext);
        attachment = {
          blobId,
          filename: source.attachment.filename,
          mimeType: source.attachment.mimeType,
          sizeBytes: bytes.length,
          contentId: null,
          inline: false,
          key: encrypted.key,
          sealedKey: encrypted.sealedKey,
          storagePath,
          bytes,
        };
      }

      const payload = {
        html: source.html,
        text: source.text,
        attachments: attachment
          ? [
              {
                blobId: attachment.blobId,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                contentId: attachment.contentId,
                inline: attachment.inline,
                key: attachment.key,
              },
            ]
          : [],
      };
      const sealed = await sealInboundMessage(source.subject, payload, user.publicKey);

      if (!threadRecord) {
        const created = await prisma.thread.create({
          data: {
            userId: user.id,
            threadKey: `seed-${messageCounter}-${randomUUID()}`,
            subjectPreview: sealed.encryptedSubject,
            lastActivityAt: sentAt,
          },
        });
        threadRecord = created;
      }
      const threadId = threadRecord.id;
      const folderId = folders[thread.folder];
      const toAddresses = (source.to ?? [DEMO_EMAIL]).map((email) => ({ email }));

      const message = await prisma.message.create({
        data: {
          userId: user.id,
          folderId,
          threadId,
          messageIdHeader: `<seed-${messageCounter}-${randomUUID()}@localhost>`,
          inReplyTo: null,
          references: [],
          fromAddress: fromEmail,
          fromName: source.fromName,
          toAddresses: toAddresses as Prisma.InputJsonValue,
          ccAddresses: [],
          bccAddresses: [],
          encryptedSubject: sealed.encryptedSubject,
          encryptedBody: sealed.encryptedBody,
          wrappedKey: sealed.wrappedKey,
          attachments: (attachment
            ? [
                {
                  blobId: attachment.blobId,
                  filename: attachment.filename,
                  mimeType: attachment.mimeType,
                  sizeBytes: attachment.sizeBytes,
                  contentId: attachment.contentId,
                  inline: attachment.inline,
                },
              ]
            : []) as Prisma.InputJsonValue,
          isRead: source.read ?? false,
          isStarred: source.starred ?? false,
          isDraft: thread.folder === "DRAFTS",
          sentAt,
          receivedAt: sentAt,
          sizeBytes: sealed.sizeBytes + (attachment?.sizeBytes ?? 0),
          spf: thread.folder === "SPAM" ? "fail" : "pass",
          dkim: thread.folder === "SPAM" ? "fail" : "pass",
          dmarc: thread.folder === "SPAM" ? "fail" : "pass",
          labels: {
            connect: (source.labels ?? []).filter((name) => labels[name]).map((name) => ({ id: labels[name] })),
          },
          trashedAt: thread.folder === "SPAM" ? null : null,
        },
      });

      if (attachment) {
        await prisma.attachment.create({
          data: {
            userId: user.id,
            messageId: message.id,
            blobId: attachment.blobId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            encryptedKey: attachment.sealedKey,
            storagePath: attachment.storagePath,
            contentId: attachment.contentId,
            inline: attachment.inline,
          },
        });
      }
      storageUsed += message.sizeBytes;
    }

    if (threadRecord) {
      await prisma.thread.update({
        where: { id: threadRecord.id },
        data: {
          messageCount: thread.messages.length,
          lastActivityAt: new Date(Date.now() - latest.hoursAgo * 3600_000),
          subjectPreview: threadRecord.subjectPreview,
        },
      });
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { storageUsedBytes: storageUsed },
  });

  await prisma.importJob.create({
    data: {
      userId: user.id,
      source: "MBOX",
      status: "COMPLETED",
      progressMessages: 1240,
      totalMessages: 1240,
      folderMapping: { "": "INBOX" },
      errors: [],
      meta: { filename: "archive.mbox" },
      startedAt: new Date(Date.now() - 86_400_000),
      completedAt: new Date(Date.now() - 86_000_000),
    },
  });

  await prisma.transportLog.create({
    data: {
      userId: user.id,
      provider: "console",
      toAddresses: [{ email: "margaret@example.com" }] as Prisma.InputJsonValue,
      subject: null,
      status: "SENT",
      preview: "Delivered by ConsoleProvider (development mode)",
    },
  });

  console.log("\n✓ Demo account ready");
  console.log("  Email:    demo@localhost");
  console.log("  Password: NyxMail!2025");
  console.log(`  TOTP:     ${DEMO_TOTP_SECRET} (run: npm run demo:totp)`);
  console.log("\n  One-time backup codes:");
  for (const code of backupCodes.plain) console.log(`    ${code}`);
  console.log("\n  24-word recovery phrase (keep offline):");
  console.log(`    ${recoveryKit.phrase}`);
  console.log("\n  Messages seeded:", messageCounter);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
