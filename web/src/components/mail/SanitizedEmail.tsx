"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, ShieldCheck } from "lucide-react";
import { useTheme } from "@/lib/client/theme";
import { buildEmailDocument, sanitizeEmailHtml } from "@/lib/client/mail-crypto";

export function SanitizedEmail({
  html,
  sender,
  messageId,
}: {
  html: string;
  sender: string;
  messageId: string;
}) {
  const { theme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [trusted, setTrusted] = useState(false);
  const [allowOnce, setAllowOnce] = useState(false);
  const [height, setHeight] = useState(260);

  useEffect(() => {
    try {
      setTrusted(window.localStorage.getItem(`nyxmail-images:${sender.toLowerCase()}`) === "1");
    } catch {
      setTrusted(false);
    }
  }, [sender]);

  const sanitized = useMemo(
    () =>
      sanitizeEmailHtml(
        html,
        allowOnce || trusted,
        typeof window !== "undefined" ? window.location.origin : "",
      ),
    [html, allowOnce, trusted],
  );
  const document = useMemo(
    () =>
      buildEmailDocument(
        sanitized.html,
        theme === "dark",
        typeof window !== "undefined" ? window.location.origin : "",
      ),
    [sanitized.html, theme],
  );

  useEffect(() => {
    setHeight(260);
  }, [messageId, document]);

  const resize = () => {
    try {
      const body = iframeRef.current?.contentDocument?.body;
      const doc = iframeRef.current?.contentDocument?.documentElement;
      const next = Math.max(body?.scrollHeight ?? 0, doc?.scrollHeight ?? 0);
      if (next > 0) setHeight(Math.min(6000, Math.max(80, next + 8)));
    } catch {
      // If the browser blocks measurement, keep the scrollable fallback.
    }
  };

  const trustSender = () => {
    try {
      window.localStorage.setItem(`nyxmail-images:${sender.toLowerCase()}`, "1");
    } catch {
      // storage may be unavailable in private mode
    }
    setTrusted(true);
    setAllowOnce(true);
  };

  return (
    <div className="min-w-0">
      {sanitized.hasRemoteImages && !(allowOnce || trusted) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted">
          <ImageOff className="h-3.5 w-3.5 shrink-0 text-faint" />
          <span>
            {sanitized.blockedImages} remote {sanitized.blockedImages === 1 ? "image" : "images"} blocked to
            protect your privacy.
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="font-semibold text-accent2 hover:underline"
              onClick={() => setAllowOnce(true)}
            >
              Load once
            </button>
            <button
              type="button"
              className="font-semibold text-accent2 hover:underline"
              onClick={trustSender}
            >
              Always for this sender
            </button>
          </div>
        </div>
      )}
      {trusted && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] text-faint">
          <ShieldCheck className="h-3 w-3 text-success" />
          Remote images proxied through NyxMail · sender trusted
          <button
            type="button"
            className="ml-1 underline hover:text-muted"
            onClick={() => {
              window.localStorage.removeItem(`nyxmail-images:${sender.toLowerCase()}`);
              setTrusted(false);
              setAllowOnce(false);
            }}
          >
            block again
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={`Message body from ${sender}`}
        srcDoc={document}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={resize}
        className="w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  );
}
