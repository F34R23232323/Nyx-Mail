import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodSchema } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function apiError(status: number, message: string, code = "error", details?: unknown): never {
  throw new ApiError(status, message, code, details);
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  return NextResponse.json(data, { ...init, headers });
}

export async function safe(handler: () => Promise<NextResponse | Response>): Promise<NextResponse | Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request",
          code: "validation_error",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    if (isPrismaUniqueError(error)) {
      return NextResponse.json({ error: "That value is already in use", code: "conflict" }, { status: 409 });
    }
    console.error("[nyxmail:api]", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Internal server error";
    return NextResponse.json({ error: message, code: "internal_error" }, { status: 500 });
  }
}

function isPrismaUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export async function parseBody<T>(request: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    apiError(400, "Expected a JSON body", "invalid_json");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

export function getClientIp(request: NextRequest): string {
  // Forwarded headers are attacker-controlled unless a trusted reverse proxy
  // is the only route to this process. Set TRUST_PROXY=true behind nginx.
  if (process.env.TRUST_PROXY !== "true") return "127.0.0.1";
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-vercel-forwarded-for") ||
    "127.0.0.1"
  );
}

export function getUserAgent(request: NextRequest): string {
  return (request.headers.get("user-agent") || "Unknown device").slice(0, 500);
}

export function assertTrustedOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>();
  if (process.env.APP_URL) {
    try {
      allowed.add(new URL(process.env.APP_URL).origin);
    } catch {
      // ignored
    }
  }
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // ignored
  }
  if (!allowed.has(origin)) {
    apiError(403, "Request origin is not allowed", "bad_origin");
  }
}

export function bearerFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)nyx_at=([^;]+)/.exec(cookieHeader);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
