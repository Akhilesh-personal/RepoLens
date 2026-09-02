interface WordmarkProps {
  variant?: "display" | "header";
}

export function Wordmark({ variant = "display" }: WordmarkProps) {
  const mark = (
    <span style={{ wordSpacing: "0.02em" }}>
      <span className="font-medium">Repo</span> <span className="font-semibold">Lens</span>
    </span>
  );

  if (variant === "header") {
    return (
      <span className="inline-flex items-baseline gap-2 text-[14px] text-[var(--text)]">
        {mark}
        <span className="text-[11px] font-normal text-[var(--text-3)]">KVS</span>
      </span>
    );
  }

  return <span className="display">{mark}</span>;
}

export function InternalSubheader() {
  return (
    <p className="mt-3 text-[13px] font-normal tracking-[0.01em] text-[var(--text-3)]">
      KVS Technologies · Internal use only
    </p>
  );
}
