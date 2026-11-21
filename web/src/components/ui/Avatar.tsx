import md5 from "blueimp-md5";
import { normalizeEmail } from "@nyxmail/shared";
import { cn, initials, avatarColor } from "@/lib/client/utils";

export function Avatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string | null;
  email?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const label = name || email || "?";
  const color = avatarColor(label);
  const normalized = email ? normalizeEmail(email) : "";
  const avatarHash = normalized ? md5(normalized) : "";
  const domain = normalized.includes("@") ? normalized.split("@").pop() ?? "" : "";
  const sizes = {
    xs: "h-7 w-7 text-[10px]",
    sm: "h-8 w-8 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  };
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        sizes[size],
        className,
      )}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      <span className="relative z-0">{initials(name || email || "?")}</span>
      {avatarHash && (
        <span
          className="absolute inset-0 z-10 rounded-full bg-cover bg-center"
          style={{
            backgroundImage: `url("/api/v1/avatars/${avatarHash}?domain=${encodeURIComponent(domain)}")`,
          }}
        />
      )}
    </span>
  );
}
