/**
 * Exercises the Gmail send path against a local test database without talking
 * to Google. Google OAuth + Gmail API calls are intercepted in-process.
 *
 * DATABASE_URL=...nyxmail_mobile_test \
 * GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test \
 * npx tsx scripts/test-gmail-send.ts
 */
import { prisma } from "@nyxmail/db";
import { encryptJson } from "@nyxmail/shared/secrets";
import { performImmediateSend } from "@nyxmail/server";
import { encryptMessageForRecipients } from "../mobile/src/lib/crypto";

const EMAIL = "mobile@example.com";
const GMAIL = "test-user@gmail.com";

async function main(): Promise<void> {
  process.env.GOOGLE_CLIENT_ID ||= "test-client";
  process.env.GOOGLE_CLIENT_SECRET ||= "test-secret";

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, publicKey: true, displayName: true },
  });
  if (!user) throw new Error("Run the test seed first");

  const existing = await prisma.gmailAccount.findFirst({
    where: { userId: user.id, googleEmail: GMAIL },
  });
  const account = existing
    ? await prisma.gmailAccount.update({
        where: { id: existing.id },
        data: {
          enabled: true,
          credentials: encryptJson({ refreshToken: "fake-refresh-token" }),
        },
      })
    : await prisma.gmailAccount.create({
        data: {
          userId: user.id,
          googleEmail: GMAIL,
          credentials: encryptJson({ refreshToken: "fake-refresh-token" }),
        },
      });

  let capturedRaw = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
      capturedRaw = body.raw ?? "";
      return new Response(
        JSON.stringify({ id: "fake-gmail-message-id", threadId: "fake-thread" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const subject = "Gmail identity test";
  const html = "<p>Sent through the connected Gmail identity.</p>";
  const text = "Sent through the connected Gmail identity.";
  const sealed = await encryptMessageForRecipients(
    subject,
    { html, text, attachments: [] },
    [{ address: EMAIL, publicKey: user.publicKey }],
  );

  const outcome = await performImmediateSend({
    userId: user.id,
    fromAddress: GMAIL,
    gmailAccountId: account.id,
    to: [{ email: "recipient@example.net", name: "Recipient" }],
    cc: [],
    bcc: [],
    sealed,
    attachments: [],
    relay: { subject, html, text },
  });
  globalThis.fetch = realFetch;

  if (!capturedRaw) throw new Error("Gmail API was not called");
  const raw = Buffer.from(capturedRaw, "base64url").toString("utf8");
  console.log("send outcome:", outcome);
  console.log("MIME head:");
  console.log(raw.split("\n").slice(0, 8).join("\n"));
  console.log("MIME checks:");
  console.log("  from:", /^From: .*test-user@gmail.com/m.exec(raw)?.[0]);
  console.log("  to:", /^To: .*recipient@example.net/m.exec(raw)?.[0]);
  console.log("  subject:", /^Subject: Gmail identity test/m.exec(raw)?.[0]);
  console.log(
    "  encrypted internal copy:",
    await prisma.message.count({
      where: { userId: user.id, fromAddress: GMAIL, folder: { type: "SENT" } },
    }),
  );
  const log = await prisma.transportLog.findFirst({
    where: { userId: user.id, provider: "gmail" },
    orderBy: { createdAt: "desc" },
  });
  console.log("  transport log:", log?.status, log?.messageId, log?.preview);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
