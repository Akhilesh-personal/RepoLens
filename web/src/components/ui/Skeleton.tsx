import { cx } from "shared";
import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cx("relative overflow-hidden rounded-[16px] bg-[var(--surface)]", className)}
      style={style}
    >
      <div className="skeleton-sheen absolute inset-0" />
    </div>
  );
}
