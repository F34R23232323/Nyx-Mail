import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "@nyxmail/db";
import { generateToken, hashToken, safeEqual } from "@nyxmail/shared/secrets";
import { cookieSecure, env } from "./env";
import { ApiError, getClientIp, getUserAgent } from "./http";

export const ACCESS_COOKIE = "nyx_at";
export const REFRESH_COOKIE = "nyx_rt";
export const CSRF_COOKIE = "nyx_csrf";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

interface AccessClaims extends JWTPayload {
  sid: string;
  sub: string;
  purpose: "access";
}

function jwtKey(): Uint8Array {
  return new TextEncoder().encode(env("JWT_SECRET"));
}

function readCookie(name: string): string | undefined {
  return cookies().get(name)?.value;
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId, purpose: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .setIssuer("nyxmail")
    .setAudience("nyxmail-web")
    .sign(jwtKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(), {
      issuer: "nyxmail",
      audience: "nyxmail-web",
    });
    if (payload.purpose !== "access" || typeof payload.sid !== "string" || typeof payload.sub !== "string") {
      throw new Error("wrong token");
    }
    return payload as AccessClaims;
  } catch {
    throw new ApiError(401, "Please sign in again", "unauthorized");
  }
}

export async function requireAuth(request?: NextRequest, options?: { csrf?: boolean }): Promise<AuthContext> {
  if (options?.csrf && request) assertCsrf(request);
  const token = readCookie(ACCESS_COOKIE);
  if (!token) throw new ApiError(401, "Please sign in again", "unauthorized");
  const claims = await verifyAccessToken(token);
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: {
      userId: true,
      revokedAt: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== claims.sub) {
    throw new ApiError(401, "Session expired or revoked", "session_revoked");
  }
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    prisma.session
      .update({ where: { id: claims.sid }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    userId: session.user.id,
    sessionId: claims.sid,
    email: session.user.email,
    displayName: session.user.displayName,
  };
}

export function assertCsrf(request: NextRequest): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const header = request.headers.get("x-csrf-token");
  const cookie = readCookie(CSRF_COOKIE);
  if (!header || !cookie || !safeEqual(header, cookie)) {
    throw new ApiError(403, "Invalid CSRF token", "csrf");
  }
}

export async function createSession(userId: string, request: NextRequest): Promise<SessionTokens> {
  const refreshSecret = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshSecret),
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      expiresAt,
    },
    select: { id: true },
  });
  return {
    accessToken: await signAccessToken(userId, session.id),
    refreshToken: `${session.id}.${refreshSecret}`,
    csrfToken,
    sessionId: session.id,
    expiresAt,
  };
}

export function applySessionCookies(response: NextResponse, tokens: SessionTokens): void {
  const secure = cookieSecure();
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: tokens.accessToken,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });
  response.cookies.set({
    name: REFRESH_COOKIE,
    value: tokens.refreshToken,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TTL_SECONDS,
  });
  response.cookies.set({
    name: CSRF_COOKIE,
    value: tokens.csrfToken,
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    response.cookies.set({ name, value: "", path: "/", maxAge: 0, httpOnly: name !== CSRF_COOKIE });
  }
}

export interface RefreshedSession {
  tokens: SessionTokens;
  userId: string;
}

export async function rotateRefreshToken(): Promise<RefreshedSession> {
  const raw = readCookie(REFRESH_COOKIE);
  if (!raw) throw new ApiError(401, "No refresh token", "unauthorized");
  const [sessionId, secret] = raw.split(".");
  if (!sessionId || !secret) throw new ApiError(401, "Malformed refresh token", "unauthorized");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      refreshTokenHash: true,
      previousTokenHash: true,
      previousTokenAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new ApiError(401, "Session expired", "session_expired");
  }
  const hash = hashToken(secret);
  const previousWithinGrace =
    Boolean(session.previousTokenHash && session.previousTokenAt) &&
    safeEqual(hash, session.previousTokenHash!) &&
    Date.now() - session.previousTokenAt!.getTime() < 60_000;
  if (!safeEqual(hash, session.refreshTokenHash) && !previousWithinGrace) {
    // Re-use of an older rotated token is a strong signal of theft. Revoke
    // the whole session rather than silently issuing new credentials. A
    // short grace window lets two tabs rotate at the same time without
    // logging each other out.
    if (session.previousTokenHash && safeEqual(hash, session.previousTokenHash)) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }
    throw new ApiError(401, "Refresh token is no longer valid", "refresh_reuse");
  }

  const nextSecret = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await prisma.session.update({
    where: { id: session.id },
    data: {
      previousTokenHash: session.refreshTokenHash,
      previousTokenAt: new Date(),
      refreshTokenHash: hashToken(nextSecret),
      expiresAt,
      lastSeenAt: new Date(),
    },
  });
  return {
    userId: session.userId,
    tokens: {
      accessToken: await signAccessToken(session.userId, session.id),
      refreshToken: `${session.id}.${nextSecret}`,
      csrfToken,
      sessionId: session.id,
      expiresAt,
    },
  };
}

export async function revokeCurrentSession(sessionId: string, userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface FlowTokenInput {
  userId: string;
  purpose: string;
  data?: Record<string, unknown>;
  expiresIn?: string;
}

export async function signFlowToken(input: FlowTokenInput): Promise<string> {
  return new SignJWT({
    purpose: input.purpose,
    ...(input.data ?? {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "10m")
    .setIssuer("nyxmail")
    .setAudience("nyxmail-flow")
    .sign(jwtKey());
}

export async function verifyFlowToken(
  token: string,
  purpose: string,
): Promise<{ userId: string; data: JWTPayload }> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(), {
      issuer: "nyxmail",
      audience: "nyxmail-flow",
    });
    if (payload.purpose !== purpose || typeof payload.sub !== "string") {
      throw new Error("purpose mismatch");
    }
    return { userId: payload.sub, data: payload };
  } catch {
    throw new ApiError(401, "This security step expired. Please start again.", "flow_expired");
  }
}

export function accessTokenFromRequest(request: NextRequest): string | null {
  const cookie = request.headers.get("cookie") || "";
  const match = /(?:^|;\s*)nyx_at=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}


/** Long-lived SSE connections cannot transparently perform the access-token
 * refresh dance. If the short access cookie has expired, fall back to the
 * rotating refresh cookie and validate the session server-side. */
export async function requireUserOrRefresh(request: NextRequest): Promise<AuthContext> {
  try {
    return await requireAuth();
  } catch {
    const raw = readCookie(REFRESH_COOKIE);
    if (!raw) throw new ApiError(401, "Sign in required", "unauthorized");
    const [sessionId, secret] = raw.split(".");
    if (!sessionId || !secret) throw new ApiError(401, "Sign in required", "unauthorized");
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        refreshTokenHash: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !safeEqual(hashToken(secret), session.refreshTokenHash)
    ) {
      throw new ApiError(401, "Sign in required", "unauthorized");
    }
    return {
      userId: session.user.id,
      sessionId,
      email: session.user.email,
      displayName: session.user.displayName,
    };
  }
}
