import { cx, tagColor } from "shared";
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tag?: string;
  className?: string;
}

export function Badge({ children, tag, className }: BadgeProps) {
  const color = tag ? tagColor(tag) : "var(--text-3)";
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[10px] border px-2 py-0.5 font-mono text-[11px] tracking-tight",
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
