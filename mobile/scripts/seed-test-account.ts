/**
 * Creates a fully populated mailbox on a local NyxMail test server.
 *
 * Usage:
 *   DATABASE_URL=...nyxmail_mobile_test \
 *   NYX_TEST_API=http://localhost:3100 \
 *   npx tsx mobile/scripts/seed-test-account.ts
 */
import { prisma } from "@nyxmail/db";
import { authenticator } from "otplib";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createKeyEnvelope,
  createRecoveryKit,
  encryptAttachmentBytes,
  encryptMessageForRecipients,
  generateKeyBundle,
  type KeyBundle,
} from "../src/lib/crypto";

const API = process.env.NYX_TEST_API || "http://localhost:3100";
const EMAIL = process.env.NYX_TEST_EMAIL || "mobile@example.com";
const PASSWORD = process.env.NYX_TEST_PASSWORD || "NyxMail!2025";
const NAME = "Aurora Stone";

const jar = new Map<string, string>();

function cookieHeader(): string {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function captureCookies(response: Response): void {
  const lines =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const line of lines) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  const cookies = cookieHeader();
  if (cookies) headers.set("cookie", cookies);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${API}${path}`, { ...init, headers, body });
  captureCookies(response);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

function address(name: string, email: string) {
  return { name, email };
}

interface SeedMessage {
  folder: "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "TRASH" | "SPAM";
  fromName: string;
  fromAddress: string;
  to?: Array<{ name: string; email: string }>;
  subject: string;
  html: string;
  text: string;
  daysAgo: number;
  read?: boolean;
  starred?: boolean;
  labels?: string[];
  attachments?: Array<{ blobId: string; filename: string; mimeType: string; sizeBytes: number; key: string }>;
  security?: boolean;
}

function htmlShell(body: string, options?: { signature?: string }): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.65;color:#20242e">
${body}
${options?.signature ? `<p style="margin-top:26px;color:#7a8194;font-size:13px">${options.signature}</p>` : ""}
</div>`;
}

async function main(): Promise<void> {
  console.log(`Seeding test mailbox against ${API}`);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("Removed previous test mailbox");
  }

  const bundle: KeyBundle = await generateKeyBundle();
  const envelope = await createKeyEnvelope(bundle, PASSWORD);
  const kit = await createRecoveryKit(bundle);

  const signup = await api<{
    setupToken: string;
    totpSecret: string;
    qrDataUrl: string;
    email: string;
  }>("/api/v1/auth/signup", {
    method: "POST",
    json: {
      email: EMAIL,
      displayName: NAME,
      password: PASSWORD,
      publicKey: bundle.publicKey,
      signingPublicKey: bundle.signingPublicKey,
      encryptedPrivateKey: envelope.encryptedPrivateKey,
      argonSalt: envelope.argonSalt,
      recoveryEncryptedPrivateKey: kit.encryptedPrivateKey,
      recoverySalt: kit.argonSalt,
      recoveryKeyHash: kit.recoveryKeyHash,
      recoveryEmail: "recovery@example.com",
    },
  });

  const code = authenticator.generate(signup.totpSecret);
  const enabled = await api<{ user: { id: string }; backupCodes: string[]; csrfToken: string }>(
    "/api/v1/auth/two-factor/enable",
    {
      method: "POST",
      json: { setupToken: signup.setupToken, code },
    },
  );

  const session = await api<{ user: { id: string; email: string } }>("/api/v1/auth/session");
  console.log(`Created ${session.user.email} (${session.user.id})`);

  const csrf = enabled.csrfToken;
  const jsonHeaders = { "x-csrf-token": csrf };

  // Labels and contacts -----------------------------------------------------
  const labelSpecs = [
    { name: "Work", color: "#8B5CF6" },
    { name: "Receipts", color: "#3FE0C5" },
    { name: "Travel", color: "#F2B95C" },
    { name: "Important", color: "#FF5E8E" },
  ];
  const labelIds = new Map<string, string>();
  for (const label of labelSpecs) {
    const result = await api<{ label: { id: string } }>("/api/v1/labels", {
      method: "POST",
      headers: jsonHeaders,
      json: label,
    });
    labelIds.set(label.name, result.label.id);
  }

  const contacts = [
    ["Maya Chen", "maya@studio-aurora.design"],
    ["Alex Rivera", "alex.rivera@hey.com"],
    ["NyxMail Team", "team@nyxmail.dev"],
    ["Linear Billing", "billing@linear.app"],
    ["Air France", "no-reply@airfrance.fr"],
    ["GitHub", "notifications@github.com"],
    ["Sofia Almeida", "sofia@lisbon.co"],
    ["Daniel Okafor", "daniel@example.com"],
  ];
  for (const [name, email] of contacts) {
    await api("/api/v1/contacts", {
      method: "POST",
      headers: jsonHeaders,
      json: { name, email },
    });
  }

  // Upload one real encrypted attachment for the welcome message ------------
  const welcomeAttachmentText = Buffer.from(
    `NYXMAIL — MOBILE QUICK START

1. Every subject, body and attachment is encrypted on this device.
2. Your password never leaves the phone.
3. Pull to refresh, swipe a conversation to archive or delete.
4. Tap the pencil to compose; attachments are encrypted before upload.

This file was encrypted with XChaCha20-Poly1305 and uploaded to the test server.
`,
    "utf8",
  );
  const encryptedAttachment = encryptAttachmentBytes(new Uint8Array(welcomeAttachmentText));
  const form = new FormData();
  form.append(
    "file",
    new Blob([encryptedAttachment.ciphertext as unknown as BlobPart], { type: "application/octet-stream" }),
    "nyxmail-quick-start.txt.nyx",
  );
  form.append("filename", "nyxmail-quick-start.txt");
  form.append("mimeType", "text/plain");
  form.append("sizeBytes", String(welcomeAttachmentText.length));
  const uploadResponse = await fetch(`${API}/api/v1/attachments`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(),
      "x-csrf-token": csrf,
    },
    body: form,
  });
  captureCookies(uploadResponse);
  if (!uploadResponse.ok) throw new Error(`attachment upload failed: ${await uploadResponse.text()}`);
  const upload = (await uploadResponse.json()) as {
    attachment: { blobId: string; id: string };
  };
  console.log(`Uploaded encrypted attachment ${upload.attachment.blobId}`);

  const folders = await prisma.folder.findMany({
    where: { userId: session.user.id },
  });
  const folderId = (type: string) => {
    const folder = folders.find((item) => item.type === type);
    if (!folder) throw new Error(`Missing folder ${type}`);
    return folder.id;
  };

  const welcomeAttachments = [
    {
      blobId: upload.attachment.blobId,
      filename: "nyxmail-quick-start.txt",
      mimeType: "text/plain",
      sizeBytes: welcomeAttachmentText.length,
      key: encryptedAttachment.key,
      contentId: null,
      inline: false,
    },
  ];

  const seeds: SeedMessage[] = [
    {
      folder: "INBOX",
      fromName: "NyxMail Team",
      fromAddress: "team@nyxmail.dev",
      subject: "Welcome to your encrypted inbox",
      daysAgo: 0,
      read: false,
      starred: true,
      labels: ["Important"],
      attachments: welcomeAttachments,
      html: htmlShell(`
        <h2 style="margin:0 0 10px;font-size:22px;color:#111827">Welcome to Nyx<span style="color:#6D4AFF">Mail</span></h2>
        <p>Your mailbox is ready, and it belongs to you. Everything you see in this app was decrypted <strong>on your phone</strong> with a key the server cannot read.</p>
        <div style="background:#f5f3ff;border:1px solid #e5ddff;border-radius:14px;padding:16px 18px;margin:18px 0">
          <p style="margin:0 0 8px;font-weight:600;color:#4c1d95">Three things worth knowing</p>
          <ul style="margin:0;padding-left:20px">
            <li>Swipe a conversation left to archive or delete it.</li>
            <li>Pull down to refresh. The badge updates as encrypted mail arrives.</li>
            <li>Your 24-word recovery kit is the only way back if you forget your password.</li>
          </ul>
        </div>
        <p>The quick-start guide attached to this message is encrypted too. Tap it to decrypt and share it.</p>
        <p style="color:#6b7280;font-size:13px">— The NyxMail team</p>
      `),
      text:
        "Welcome to NyxMail. Your mailbox is ready and everything is decrypted on your phone. Swipe to archive, pull to refresh, and keep your 24-word recovery kit safe. The attached quick-start guide is encrypted too.",
    },
    {
      folder: "INBOX",
      fromName: "Maya Chen",
      fromAddress: "maya@studio-aurora.design",
      subject: "Design review · Aurora mobile",
      daysAgo: 0,
      read: false,
      labels: ["Work"],
      html: htmlShell(`
        <p>Hey Aurora,</p>
        <p>The new mobile direction is gorgeous. A few notes before Thursday:</p>
        <ul>
          <li>Keep the unread indicator quieter — one violet dot is enough.</li>
          <li>The compose sheet should feel like a native control, not a page.</li>
          <li>Try the "Onyx" palette for the inbox, it makes the avatars sing.</li>
        </ul>
        <p>I pushed a Figma link below. The motion notes are in the comments.</p>
        <p><a href="https://www.figma.com/file/aurora-mobile">Open the Aurora mobile file</a></p>
        <p>Thanks!<br/>Maya</p>
      `),
      text:
        "Hey Aurora, the new mobile direction is gorgeous. A few notes: keep the unread indicator quieter, make the compose sheet feel native, try the Onyx palette. Figma link attached. Thanks, Maya",
    },
    {
      folder: "INBOX",
      fromName: "Linear Billing",
      fromAddress: "billing@linear.app",
      subject: "Your invoice for October",
      daysAgo: 1,
      read: true,
      labels: ["Receipts"],
      html: htmlShell(`
        <h3 style="margin:0 0 6px">Invoice #INV-20931</h3>
        <p style="color:#6b7280;margin-top:0">October 2026 · Paid</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px 0">Linear Standard · 8 seats</td><td align="right">$64.00</td></tr>
          <tr style="border-bottom:1px solid #e5e7eb"><td style="padding:8px 0">Tax</td><td align="right">$12.80</td></tr>
          <tr><td style="padding:10px 0;font-weight:600">Total</td><td align="right" style="font-weight:600">$76.80</td></tr>
        </table>
        <p>Thank you for building with Linear.</p>
      `),
      text: "Invoice INV-20931 for October 2026. Linear Standard, 8 seats, $64.00 plus $12.80 tax. Total $76.80. Paid.",
    },
    {
      folder: "INBOX",
      fromName: "Air France",
      fromAddress: "no-reply@airfrance.fr",
      subject: "Flight confirmation · CDG → LIS",
      daysAgo: 2,
      read: false,
      labels: ["Travel"],
      html: htmlShell(`
        <div style="background:#002157;color:#fff;padding:20px;border-radius:14px">
          <p style="margin:0;font-size:12px;letter-spacing:2px;opacity:.8">BOARDING PASS</p>
          <h2 style="margin:6px 0 2px">Paris → Lisbon</h2>
          <p style="margin:0;opacity:.85">AF 1024 · Saturday, 28 November · 09:35</p>
        </div>
        <p style="margin-top:18px"><strong>Confirmation:</strong> XY7K2P</p>
        <p><strong>Seat:</strong> 14A · Window</p>
        <p><strong>Terminal:</strong> 2F · Gate F32</p>
        <p>Check-in opens 30 hours before departure. Have a pleasant flight.</p>
      `),
      text:
        "Boarding pass: Paris to Lisbon, AF 1024, Saturday 28 November at 09:35. Confirmation XY7K2P, seat 14A, terminal 2F gate F32.",
    },
    {
      folder: "INBOX",
      fromName: "NyxMail Security",
      fromAddress: "security@nyxmail.dev",
      subject: "New sign-in to your mailbox",
      daysAgo: 2,
      read: true,
      security: true,
      html: htmlShell(`
        <p>We noticed a new sign-in to your NyxMail account.</p>
        <table style="margin:14px 0;font-size:13px;color:#4b5563">
          <tr><td style="padding:3px 16px 3px 0;color:#9ca3af">Device</td><td>NyxMail Mobile · Android</td></tr>
          <tr><td style="padding:3px 16px 3px 0;color:#9ca3af">Location</td><td>Paris, France</td></tr>
          <tr><td style="padding:3px 16px 3px 0;color:#9ca3af">Time</td><td>Today at 09:41</td></tr>
        </table>
        <p>If this was you, no action is needed. If not, change your password and revoke the session in Settings → Security.</p>
      `),
      text:
        "A new sign-in to your NyxMail account was detected: NyxMail Mobile on Android, Paris, France. If this wasn't you, change your password and revoke the session.",
    },
    {
      folder: "INBOX",
      fromName: "GitHub",
      fromAddress: "notifications@github.com",
      subject: "[nyxmail/mobile] PR #42 · native compose sheet",
      daysAgo: 3,
      read: false,
      labels: ["Work"],
      html: htmlShell(`
        <p><strong>daniel</strong> requested your review on pull request #42.</p>
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:14px 0">
          <p style="margin:0 0 4px;font-weight:600">feat: native compose sheet + encrypted drafts</p>
          <p style="margin:0;color:#6b7280;font-size:13px">12 files changed · +482 −97</p>
        </div>
        <p>Drafts now autosave every five seconds with the same XSalsa20 envelope used by the web client.</p>
        <p style="color:#6b7280;font-size:12px">You are receiving this because you are subscribed to this repository.</p>
      `),
      text:
        "GitHub: daniel requested your review on pull request #42, feat: native compose sheet + encrypted drafts. 12 files changed.",
    },
    {
      folder: "INBOX",
      fromName: "The Marginalian",
      fromAddress: "newsletter@themarginalian.org",
      subject: "On the measure of our aliveness",
      daysAgo: 5,
      read: true,
      html: htmlShell(`
        <img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80" alt="Mountain lake at dusk" style="width:100%;border-radius:12px" />
        <h2 style="font-family:Georgia,serif;font-weight:400;margin:20px 0 10px">On the measure of our aliveness</h2>
        <p style="font-family:Georgia,serif;font-size:16px;line-height:1.8">We live in a culture that mistakes motion for meaning, that measures a life in milestones rather than in moments of undivided attention.</p>
        <p style="font-family:Georgia,serif;font-size:16px;line-height:1.8">And yet the things that make us feel most alive are rarely the things we can put on a timeline.</p>
        <a href="https://www.themarginalian.org/">Read the full essay →</a>
      `),
      text:
        "On the measure of our aliveness. We live in a culture that mistakes motion for meaning, measuring a life in milestones rather than moments of undivided attention.",
    },
    {
      folder: "ARCHIVE",
      fromName: "Sofia Almeida",
      fromAddress: "sofia@lisbon.co",
      subject: "Contract countersigned",
      daysAgo: 8,
      read: true,
      html: htmlShell(`
        <p>All set — the countersigned contract is attached to our shared drive.</p>
        <p>Looking forward to starting on the 1st. I'll send the onboarding list tomorrow.</p>
        <p>Talk soon,<br/>Sofia</p>
      `),
      text: "All set — the countersigned contract is in the shared drive. Looking forward to starting on the 1st. Sofia",
    },
    {
      folder: "TRASH",
      fromName: "Deal Hunter",
      fromAddress: "promo@deals.example",
      subject: "Last chance: 80% off everything",
      daysAgo: 9,
      read: true,
      html: htmlShell("<p>This is a promotional message. 80% off everything, today only.</p>"),
      text: "This is a promotional message. 80% off everything, today only.",
    },
    {
      folder: "SENT",
      fromName: NAME,
      fromAddress: EMAIL,
      to: [address("Alex Rivera", "alex.rivera@hey.com")],
      subject: "Re: Weekend in Lisbon?",
      daysAgo: 1,
      read: true,
      html: htmlShell(`
        <p>Lisbon sounds perfect. Let's do the 14th — I can get in Friday night.</p>
        <p>Book the place with the terrace if it's still free. I'll bring the camera.</p>
        <p style="color:#7a8194;font-size:13px">— Aurora</p>
      `),
      text: "Lisbon sounds perfect. Let's do the 14th — I can get in Friday night. Book the place with the terrace if it's still free. Aurora",
    },
    {
      folder: "DRAFTS",
      fromName: NAME,
      fromAddress: EMAIL,
      to: [address("Daniel Okafor", "daniel@example.com")],
      subject: "Launch checklist",
      daysAgo: 0,
      read: true,
      html: htmlShell(`
        <p>Draft notes for Monday:</p>
        <ul>
          <li>Ship the signed APK to the test group.</li>
          <li>Rotate the DKIM key after the announcement.</li>
          <li>Check push notifications on a real device.</li>
        </ul>
        <p>Still need to add the changelog link.</p>
      `),
      text: "Draft notes for Monday: ship the signed APK, rotate the DKIM key, check notifications. Still need the changelog link.",
    },
  ];

  // The Lisbon thread has an incoming message in the same conversation as the
  // sent reply above. Create it first so both can share a thread.
  const threadMessages = new Map<string, SeedMessage[]>();
  const order: string[] = [];
  for (const seed of seeds) {
    const key = seed.subject.startsWith("Re: Weekend in Lisbon")
      ? "lisbon"
      : `${seed.subject}`;
    if (!threadMessages.has(key)) {
      threadMessages.set(key, []);
      order.push(key);
    }
    threadMessages.get(key)!.push(seed);
  }
  threadMessages.get("lisbon")!.unshift({
    folder: "INBOX",
    fromName: "Alex Rivera",
    fromAddress: "alex.rivera@hey.com",
    subject: "Weekend in Lisbon?",
    daysAgo: 2,
    read: true,
    html: htmlShell(`
      <p>Aurora!</p>
      <p>I found a tiny place in Alfama with a roof terrace and a ridiculous view. Free the weekend of the 14th?</p>
      <p>Flights from Paris are cheap right now. Say yes.</p>
      <p>— Alex</p>
    `),
    text: "Aurora! I found a tiny place in Alfama with a roof terrace and a ridiculous view. Free the weekend of the 14th? Say yes. Alex",
  });

  let total = 0;
  for (const key of order) {
    const messages = threadMessages.get(key)!;
    const now = Date.now();
    const dates = messages.map((message) => new Date(now - message.daysAgo * 86_400_000));
    const latestDate = new Date(Math.max(...dates.map((date) => date.getTime())));
    const subject = messages[0].subject.replace(/^Re:\s*/, "");
    const thread = await prisma.thread.create({
      data: {
        userId: session.user.id,
        threadKey: `seed-${randomUUID()}`,
        subjectPreview: "",
        lastActivityAt: latestDate,
        messageCount: messages.length,
      },
    });
    let subjectPreview = "";
    for (const [index, message] of messages.entries()) {
      const to =
        message.to ??
        [address(NAME, EMAIL)];
      const toEmails = to.map((item) => item.email);
      const recipients = Array.from(new Set([EMAIL, ...toEmails]));
      const sealed = await encryptMessageForRecipients(
        message.subject,
        {
          html: message.html,
          text: message.text,
          attachments: message.attachments ?? [],
        },
        recipients.map((email) => ({ address: email, publicKey: bundle.publicKey })),
      );
      const wrap = sealed.wraps[EMAIL.toLowerCase()];
      const sentAt = dates[index];
      subjectPreview = sealed.encryptedSubject;
      const created = await prisma.message.create({
        data: {
          userId: session.user.id,
          folderId: folderId(message.folder),
          threadId: thread.id,
          messageIdHeader: `<${randomUUID()}@example.com>`,
          inReplyTo: index > 0 ? `<thread-${thread.id}@example.com>` : null,
          references: index > 0 ? [`<thread-${thread.id}@example.com>`] : [],
          fromAddress: message.fromAddress,
          fromName: message.fromName,
          toAddresses: to as unknown as object,
          ccAddresses: [],
          bccAddresses: [],
          encryptedSubject: sealed.encryptedSubject,
          encryptedBody: sealed.encryptedBody,
          wrappedKey: wrap,
          attachments: (message.attachments ?? []).map((attachment) => ({
            blobId: attachment.blobId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            key: attachment.key,
            contentId: null,
            inline: false,
          })) as unknown as object,
          isRead: Boolean(message.read),
          isStarred: Boolean(message.starred),
          isDraft: message.folder === "DRAFTS",
          sentAt,
          receivedAt: sentAt,
          sizeBytes:
            Buffer.byteLength(sealed.encryptedSubject) + Buffer.byteLength(sealed.encryptedBody),
          spf: message.security ? "pass" : "pass",
          dkim: message.security ? "pass" : "pass",
          dmarc: message.security ? "pass" : "pass",
          labels: {
            connect: (message.labels ?? [])
              .map((label) => labelIds.get(label))
              .filter((id): id is string => Boolean(id))
              .map((id) => ({ id })),
          },
        },
      });
      total += 1;
      if (message.attachments?.length) {
        await prisma.attachment.updateMany({
          where: { userId: session.user.id, blobId: message.attachments[0].blobId },
          data: { messageId: created.id },
        });
      }
    }
    await prisma.thread.update({
      where: { id: thread.id },
      data: { subjectPreview, messageCount: messages.length, lastActivityAt: latestDate },
    });
  }

  await prisma.contact.updateMany({
    where: { userId: session.user.id, email: "team@nyxmail.dev" },
    data: { name: "NyxMail Team" },
  });

  const recoveryPath = "mobile/credentials/test-account-full.txt";
  await mkdir("mobile/credentials", { recursive: true });
  await writeFile(
    recoveryPath,
    [
      "NYXMAIL MOBILE TEST ACCOUNT",
      "===========================",
      `Server: ${API}`,
      `Email: ${EMAIL}`,
      `Password: ${PASSWORD}`,
      `TOTP secret: ${signup.totpSecret}`,
      `Current TOTP: ${authenticator.generate(signup.totpSecret)}`,
      "",
      "Recovery phrase:",
      kit.phrase,
      "",
      `Backup codes: ${enabled.backupCodes.join(", ")}`,
      "",
    ].join("\n"),
  );

  console.log(`Seeded ${total} messages across ${order.length} threads`);
  console.log(`Credentials written to ${recoveryPath}`);
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log(`TOTP secret: ${signup.totpSecret}`);
  console.log(`Current code: ${authenticator.generate(signup.totpSecret)}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
