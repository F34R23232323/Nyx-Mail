import { useEffect, useRef } from "react";

export type MailEvent =
  | { type: "mail-changed" }
  | { type: "sent" }
  | { type: "draft-saved" }
  | { type: "thread-updated"; threadId: string; action: string };

const listeners = new Set<(event: MailEvent) => void>();

export function emitMailEvent(event: MailEvent): void {
  for (const listener of listeners) listener(event);
}

export function useMailEvent(handler: (event: MailEvent) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: MailEvent) => ref.current(event);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [enabled]);
}
