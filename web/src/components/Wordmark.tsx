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
      </span>
    );
  }

  return <span className="display">{mark}</span>;
}

export function Tagline() {
  return (
    <p className="mt-3 text-[13px] font-normal tracking-[0.01em] text-[var(--text-3)]">
      RepoLens — a tool that indexes a GitHub repository and explains what every file in it does, so you can get oriented in an unfamiliar codebase without reading it line by line.
    </p>
  );
}
