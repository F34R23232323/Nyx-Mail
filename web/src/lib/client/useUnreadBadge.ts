"use client";

import { useEffect, useRef } from "react";

function drawFavicon(count: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const radius = 15;
  context.fillStyle = "#F9386F";
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(64, 0, 64, 64, radius);
  context.arcTo(64, 64, 0, 64, radius);
  context.arcTo(0, 64, 0, 0, radius);
  context.arcTo(0, 0, 64, 0, radius);
  context.closePath();
  context.fill();
  context.fillStyle = "#FFFFFF";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const label = count > 99 ? "99+" : String(count);
  context.font = `600 ${label.length > 2 ? 24 : label.length > 1 ? 31 : 38}px Inter, Arial, sans-serif`;
  context.fillText(label, 32, 34);
  return canvas.toDataURL("image/png");
}

export function useUnreadBadge(unread: number): void {
  const initialTitle = useRef<string | null>(null);
  const initialIcon = useRef<string | null>(null);

  useEffect(() => {
    if (initialTitle.current === null) initialTitle.current = document.title;
    if (initialIcon.current === null) {
      initialIcon.current =
        document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.getAttribute("href") ?? null;
    }
    document.title = unread > 0 ? `(${unread}) NyxMail` : "NyxMail";
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (unread > 0) {
      link.type = "image/png";
      link.href = drawFavicon(unread);
    } else if (initialIcon.current) {
      link.href = initialIcon.current;
    }
    return () => {
      if (unread > 0) {
        document.title = initialTitle.current || "NyxMail";
        if (initialIcon.current && link) link.href = initialIcon.current;
      }
    };
  }, [unread]);
}

export async function requestBrowserNotifications(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, tag?: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "/icon.svg", silent: false });
  } catch {
    // Browsers can reject constructors outside a user gesture; SSE toasts
    // remain available as a fallback.
  }
}
