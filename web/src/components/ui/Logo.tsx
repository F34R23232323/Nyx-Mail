import { cn } from "@/lib/client/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-[9px] bg-gradient-to-br from-[#9A8AFF] via-[#806CFF] to-[#6247E8] text-white shadow-[0_0_0_1px_rgba(255,255,255,.12)_inset,0_2px_8px_rgba(36,23,86,.35)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[66%] w-[66%]">
        <path d="M2.6 6.4 12 12.8l9.4-6.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M2.5 7.1v9.4c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V7.1c0-1.4-1.6-2.2-2.7-1.4L12 10.5 5.2 5.7C4.1 4.9 2.5 5.7 2.5 7.1Z"
          fill="currentColor"
          fillOpacity=".92"
        />
        <path d="M2.7 16.3 9.4 11M21.3 16.3 14.6 11" stroke="#806CFF" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
      </svg>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className="h-[30px] w-[30px]" />
      {!compact && (
        <span className="text-[17px] font-semibold leading-none tracking-[-0.015em] text-ink">
          Nyx<span className="text-ink/90">Mail</span>
        </span>
      )}
    </span>
  );
}
