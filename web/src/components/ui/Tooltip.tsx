import { cx } from "shared";
import { useId, useState, type ReactNode } from "react";

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({ label, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cx("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[var(--hairline)] bg-[var(--void-2)] px-2 py-1 font-mono text-[11px] text-[var(--text-2)] shadow-lg transition-opacity duration-150",
          side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
