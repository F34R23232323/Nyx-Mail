import type { NextRequest } from "next/server";
import { prisma } from "@nyxmail/db";
import { requireUserOrRefresh } from "@/lib/auth";
import { unreadMessageWhere } from "@/lib/unread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireUserOrRefresh(request);
  const encoder = new TextEncoder();
  const initialUnread = await prisma.message.count({
    where: {
      ...unreadMessageWhere(auth.userId),
      folder: { type: "INBOX" },
    },
  });
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastReceived = new Date();
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (heartbeat) clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      const poll = async () => {
        if (closed) return;
        try {
          const [unread, latest] = await Promise.all([
            prisma.message.count({
              where: {
                ...unreadMessageWhere(auth.userId),
                folder: { type: "INBOX" },
              },
            }),
            prisma.message.findFirst({
              where: {
                userId: auth.userId,
                receivedAt: { gt: lastReceived },
                folder: { type: "INBOX" },
              },
              orderBy: { receivedAt: "desc" },
              select: { threadId: true, receivedAt: true },
            }),
          ]);
          send("unread", { unread });
          if (latest) {
            lastReceived = latest.receivedAt;
            send("mail", { threadId: latest.threadId, unread });
          }
        } catch {
          send("ping", { at: Date.now() });
        }
      };

      send("unread", { unread: initialUnread });
      void poll();
      interval = setInterval(() => void poll(), 5000);
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
          } catch {
            cleanup();
          }
        }
      }, 20_000);
      timeout = setTimeout(cleanup, 9 * 60 * 1000);
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (heartbeat) clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
