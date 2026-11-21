import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Prisma } from "@nyxmail/db";
import { prisma } from "@nyxmail/db";
import { encryptJson } from "@nyxmail/shared/secrets";
import { appUrl } from "@/lib/env";
import { exchangeGmailCode, gmailStateIsMobile } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsUrl(params: Record<string, string>): string {
  const url = new URL("/settings", appUrl());
  url.searchParams.set("tab", "imports");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const mobile = await gmailStateIsMobile(state);
  const mobileError = (message: string) =>
    NextResponse.redirect(
      `nyxmail://gmail-error?message=${encodeURIComponent(message.slice(0, 160))}`,
    );
  if (oauthError) {
    if (mobile) return mobileError(oauthError);
    return NextResponse.redirect(settingsUrl({ gmailError: oauthError.slice(0, 120) }));
  }
  if (!code || !state) {
    if (mobile) return mobileError("Google did not return an authorization code");
    return NextResponse.redirect(settingsUrl({ gmailError: "Google did not return an authorization code" }));
  }
  try {
    const { userId, tokens, mobile: mobileFlow } = await exchangeGmailCode(code, state);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new Error("Account no longer exists");
    if (!tokens.email) throw new Error("Google did not return the Gmail address");
    const existingAccount = await prisma.gmailAccount.findUnique({
      where: { userId_googleEmail: { userId, googleEmail: tokens.email } },
      select: { id: true },
    });
    await prisma.gmailAccount.upsert({
      where: {
        userId_googleEmail: { userId, googleEmail: tokens.email },
      },
      create: {
        userId,
        googleEmail: tokens.email,
        credentials: encryptJson({ refreshToken: tokens.refreshToken }),
        lastSyncAt: new Date(),
      },
      update: {
        credentials: encryptJson({ refreshToken: tokens.refreshToken }),
        lastSyncAt: new Date(),
        enabled: true,
      },
    });
    // A mobile "send from Gmail" connection only needs the account row; it
    // must not silently start a second full mailbox import. Web users still
    // get the original import behavior.
    if (!mobileFlow && !existingAccount) {
      const active = await prisma.importJob.count({
        where: { userId, status: { in: ["PENDING", "RUNNING", "PAUSED"] } },
      });
      if (active >= 3) throw new Error("You already have three active imports");
      await prisma.importJob.create({
        data: {
          userId,
          source: "GMAIL",
          status: "PENDING",
          config: encryptJson({
            kind: "gmail",
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken,
            accessTokenExpiresAt: tokens.expiresAt,
            googleEmail: tokens.email,
          }) as unknown as Prisma.InputJsonValue,
          meta: {
            googleEmail: tokens.email,
            continuousSync: true,
          } as Prisma.InputJsonValue,
        },
      });
    }
    if (mobileFlow) {
      return NextResponse.redirect(
        `nyxmail://gmail-connected?email=${encodeURIComponent(tokens.email)}`,
      );
    }
    return NextResponse.redirect(settingsUrl({ gmailConnected: "1" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connection failed";
    if (mobile) return mobileError(message);
    return NextResponse.redirect(settingsUrl({ gmailError: message.slice(0, 160) }));
  }
}
