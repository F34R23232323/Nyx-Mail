import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { findLocalRecipient } from "@nyxmail/server";
import { normalizeEmail } from "@nyxmail/shared";
import { requireAuth } from "@/lib/auth";
import { ApiError, json, safe } from "@/lib/http";
import { consumeLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return safe(async () => {
    const auth = await requireAuth();
    await consumeLimit(`keys:${auth.userId}`, 240, 5 * 60 * 1000);
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        email: true,
        argonSalt: true,
        encryptedPrivateKey: true,
        publicKey: true,
        signingPublicKey: true,
      },
    });
    if (!user) throw new ApiError(404, "Account not found", "not_found");
    const raw = new URL(request.url).searchParams.get("addresses") || "";
    const addresses = Array.from(
      new Set(
        raw
          .split(",")
          .map((value) => normalizeEmail(value))
          .filter(Boolean),
      ),
    ).slice(0, 100);
    const recipients = [];
    for (const address of addresses) {
      const recipient = await findLocalRecipient(address);
      if (recipient) {
        recipients.push({
          address: recipient.matchedAddress,
          publicKey: recipient.publicKey,
          local: true as const,
        });
      }
    }
    return json(
      {
        key: {
          email: user.email,
          argonSalt: user.argonSalt,
          encryptedPrivateKey: user.encryptedPrivateKey,
          publicKey: user.publicKey,
          signingPublicKey: user.signingPublicKey,
        },
        recipients,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
