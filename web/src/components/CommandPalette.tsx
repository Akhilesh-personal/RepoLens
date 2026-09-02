import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { primaryTag, tagColor, type SearchHit } from "shared";
import { api } from "../lib/api";

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        return;
      }
      api(`/api/search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json() as Promise<{ results: SearchHit[] }>)
        .then((data) => setResults(data.results ?? []))
        .catch(() => setResults([]));
    }, 150);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query, open]);

  function go(hit: SearchHit) {
    setOpen(false);
    if (hit.kind === "repo") {
      navigate(`/repo/${hit.slug}`);
      return;
    }
    const fileParam = hit.kind === "file" ? `?file=${encodeURIComponent(hit.id)}` : "";
    navigate(`/repo/${hit.slug}${fileParam}`);
  }

  const files = results.filter((r) => r.kind === "file");
  const folders = results.filter((r) => r.kind === "folder");
  const repos = results.filter((r) => r.kind === "repo");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div
        className="absolute inset-0 bg-black/50"
        style={{ backdropFilter: "blur(12px)" }}
        onClick={() => setOpen(false)}
      />
      <div className="relative mx-auto mt-[12vh] w-[min(640px,calc(100%-32px))]">
        <Command
          className="overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--void-2)] shadow-2xl"
          loop
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search files, folders, repos…"
            className="h-12 w-full border-b border-[var(--hairline)] bg-transparent px-4 font-mono text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
          />
          <Command.List className="max-h-[min(420px,60vh)] overflow-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-[var(--text-3)]">
              {query ? "No matches" : "Start typing to search summaries"}
            </Command.Empty>
            <Group heading="Files" items={files} query={query} onSelect={go} />
            <Group heading="Folders" items={folders} query={query} onSelect={go} />
            <Group heading="Repositories" items={repos} query={query} onSelect={go} />
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

interface GroupProps {
  heading: string;
  items: SearchHit[];
  query: string;
  onSelect: (hit: SearchHit) => void;
}

function Group({ heading, items, query, onSelect }: GroupProps) {
  if (items.length === 0) return null;
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
    >
      {items.map((item) => {
        const color = tagColor(primaryTag(item.tags));
        return (
          <Command.Item
            key={`${item.kind}:${item.id}:${item.slug}`}
            value={`${item.path} ${item.role ?? ""} ${item.snippet}`}
            onSelect={() => onSelect(item)}
            className="flex cursor-pointer items-start gap-2 rounded-[10px] px-2 py-2 data-[selected=true]:bg-[var(--surface-2)]"
          >
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: item.kind === "file" ? color : "var(--hairline-2)" }}
            />
            <div className="min-w-0">
              <p className="mono truncate text-[12px] text-[var(--text)]">{item.path}</p>
              {item.snippet ? (
                <p className="line-clamp-2 text-[12px] text-[var(--text-3)]">
                  {emphasize(item.snippet, query)}
                </p>
              ) : null}
            </div>
          </Command.Item>
        );
      })}
    </Command.Group>
  );
}

function emphasize(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 160);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, end);
  return (
    <>
      {start > 0 ? "…" : ""}
      {before}
      <mark className="bg-transparent font-medium text-[var(--text)]">{match}</mark>
      {after}
    </>
  );
}
