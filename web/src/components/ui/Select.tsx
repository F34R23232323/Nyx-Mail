"use client";

import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Dropdown } from "./Dropdown";
import { cn } from "@/lib/client/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
  panelWidth?: number;
  disabled?: boolean;
}

export function Select({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  placeholder = "Select…",
  size = "md",
  className,
  panelWidth = 260,
  disabled,
}: SelectProps) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className={cn("w-full", className)}>
      {label && <span className="label">{label}</span>}
      <Dropdown
        align="start"
        width={panelWidth}
        panelClassName="max-h-64"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={ariaLabel ?? label ?? placeholder}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border border-border bg-canvas text-left text-ink outline-none transition-colors hover:border-muted/40 focus-visible:border-accent/60",
              size === "sm" ? "h-8 px-2 text-[11px]" : "h-[42px] rounded-xl px-2.5 text-xs",
              disabled && "cursor-not-allowed opacity-50",
              open && "border-accent/50 bg-raised/40",
            )}
          >
            {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-faint")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        )}
        sections={[
          {
            items: options.map((option) => ({
              key: option.value,
              label: option.label,
              hint: option.hint,
              icon: option.icon,
              disabled: option.disabled,
              checked: option.value === value,
              onSelect: () => onChange(option.value),
            })),
          },
        ]}
      />
    </div>
  );
}
