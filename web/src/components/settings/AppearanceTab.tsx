"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/client/theme";
import { useToast } from "@/lib/client/toast";
import { useAuth } from "@/lib/client/auth";
import { Button } from "@/components/ui/Button";
import { requestBrowserNotifications } from "@/lib/client/useUnreadBadge";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setNotifications(window.localStorage.getItem("nyxmail-browser-notifications") === "1");
    if ("Notification" in window) setPermission(Notification.permission);
    else setPermission("unsupported");
  }, []);

  const toggleNotifications = async () => {
    if (notifications) {
      window.localStorage.setItem("nyxmail-browser-notifications", "0");
      setNotifications(false);
      return;
    }
    const result = await requestBrowserNotifications();
    setPermission(result);
    if (result === "granted") {
      window.localStorage.setItem("nyxmail-browser-notifications", "1");
      setNotifications(true);
      toast({ title: "Browser notifications enabled", tone: "success" });
    } else {
      toast({
        title: "Notifications were not enabled",
        description: "Your browser blocked permission. Enable it in site settings and try again.",
        tone: "warning",
      });
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Appearance</h2>
        <p className="mt-0.5 text-[11px] text-muted">Theme is stored locally on this device.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            { value: "dark" as const, label: "Dark", icon: Moon, preview: "#27252C" },
            { value: "light" as const, label: "Light", icon: Sun, preview: "#F5F6FA" },
          ].map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={`relative overflow-hidden rounded-xl border p-4 text-left transition-all ${
                  theme === option.value ? "border-accent/60 bg-accent/[0.04] shadow-glow" : "border-border bg-canvas hover:border-accent/30"
                }`}
              >
                <span
                  className="mb-3 block h-16 rounded-lg border border-black/10"
                  style={{
                    background: option.value === "dark"
                      ? "linear-gradient(135deg,#2D303E 0 45%,#27252C 45%)"
                      : "linear-gradient(135deg,#FFFFFF 0 45%,#F5F6FA 45%)",
                  }}
                />
                <span className="flex items-center gap-2 text-xs font-medium text-ink">
                  <Icon className="h-3.5 w-3.5" /> {option.label}
                </span>
                {theme === option.value && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Bell className="h-4 w-4 text-accent2" /> Browser notifications
            </h2>
            <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-muted">
              When enabled, new-mail notifications show only generic text. Subjects stay encrypted, so the
              notification cannot reveal message content.
            </p>
            <p className="mt-1 text-[10px] text-faint">
              Permission: {permission === "unsupported" ? "not supported by this browser" : permission}
              {" · "}
              recipient: {user?.email}
            </p>
          </div>
          <Button
            type="button"
            variant={notifications ? "secondary" : "primary"}
            onClick={() => void toggleNotifications()}
            disabled={permission === "unsupported"}
          >
            {notifications ? "Disable notifications" : "Enable notifications"}
          </Button>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-ink">Privacy defaults</h2>
        <div className="mt-4 space-y-3">
          {[
            ["Remote images", "Blocked by default; per-sender trust stored locally."],
            ["Sender avatars", "Gravatar lookups go through the server using a hashed address; initials remain when no photo exists."],
            ["Search index", "Decrypted locally and cached in IndexedDB on this device."],
            ["Read receipts", "Not implemented. No tracking pixels are loaded."],
            ["Analytics", "None. No third-party scripts are loaded by NyxMail."],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <div>
                <p className="text-[11px] font-medium text-ink">{title}</p>
                <p className="text-[10px] leading-relaxed text-muted">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
