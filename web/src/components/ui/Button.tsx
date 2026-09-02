import { cx } from "shared";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "quiet";
}

export function Button({ className, variant = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center rounded-[10px] px-3.5 py-2 text-[13px] font-medium transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        variant === "primary" &&
          "bg-[var(--surface-2)] text-[var(--text)] border border-[var(--hairline)] hover:border-[var(--hairline-2)] focus-visible:outline-[var(--api)]",
        variant === "ghost" &&
          "bg-transparent text-[var(--text-2)] border border-transparent hover:bg-[var(--surface)] hover:text-[var(--text)] focus-visible:outline-[var(--api)]",
        variant === "quiet" &&
          "bg-[var(--surface)] text-[var(--text-2)] border border-[var(--hairline)] hover:text-[var(--text)] focus-visible:outline-[var(--api)]",
        className,
      )}
      {...props}
    />
  );
}
