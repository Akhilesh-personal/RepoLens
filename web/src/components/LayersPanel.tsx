import { useMemo, type ReactNode } from "react";
import {
  canonicalTag,
  fileName,
  TAG_COLORS,
  type GraphNode,
  type TagKey,
} from "shared";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export const LAYERS_PANEL_WIDTH = 340;

export type LayerGroup = {
  tag: TagKey;
  files: GraphNode[];
};

interface LayersPanelProps {
  nodes: GraphNode[];
  selectedId: string | null;
  openTags: ReadonlySet<TagKey>;
  query: string;
  onQueryChange: (value: string) => void;
  onToggleTag: (tag: TagKey) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  header?: ReactNode;
  footer?: ReactNode;
}

export function groupLayers(nodes: GraphNode[]): LayerGroup[] {
  const map = new Map<TagKey, GraphNode[]>();
  for (const node of nodes) {
    const keys = new Set<TagKey>();
    for (const tag of node.tags) keys.add(canonicalTag(tag));
    if (keys.size === 0) keys.add(canonicalTag("util"));
    for (const key of keys) {
      const list = map.get(key);
      if (list) list.push(node);
      else map.set(key, [node]);
    }
  }
  return [...map.entries()]
    .map(([tag, files]) => ({
      tag,
      files: [...files].sort((a, b) =>
        fileName(a.path).localeCompare(fileName(b.path), undefined, { sensitivity: "base" }),
      ),
    }))
    .filter((layer) => layer.files.length > 0)
    .sort((a, b) => b.files.length - a.files.length || a.tag.localeCompare(b.tag));
}

export function fileMatchesQuery(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (node.name || fileName(node.path)).toLowerCase();
  const role = node.role.toLowerCase();
  return name.includes(q) || role.includes(q);
}

export function LayersPanel({
  nodes,
  selectedId,
  openTags,
  query,
  onQueryChange,
  onToggleTag,
  onSelect,
  onHover,
  header,
  footer,
}: LayersPanelProps) {
  const reduced = usePrefersReducedMotion();
  const layers = useMemo(() => groupLayers(nodes), [nodes]);
  const q = query.trim();
  const searching = q.length > 0;

  const visible = useMemo(() => {
    if (!searching) return layers;
    return layers
      .map((layer) => ({
        ...layer,
        files: layer.files.filter((file) => fileMatchesQuery(file, q)),
      }))
      .filter((layer) => layer.files.length > 0);
  }, [layers, searching, q]);

  return (
    <aside
      className="layers-panel pointer-events-auto flex h-full w-full flex-col md:w-[340px]"
      style={{
        background: "rgba(5, 6, 10, 0.82)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRight: "1px solid var(--hairline)",
      }}
    >
      {header ? <div className="flex-none px-4 pb-3 pt-4 max-md:pr-36">{header}</div> : null}
      <div className="flex-none px-4 pb-3">
        <label className="sr-only" htmlFor="layers-search">
          Filter files
        </label>
        <input
          id="layers-search"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by file or role"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-[10px] border border-[var(--hairline)] bg-[var(--void-2)] px-3 py-2 font-sans text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] focus-visible:border-[var(--hairline-2)]"
        />
      </div>
      <p className="label flex-none px-4 pb-2">Layers</p>
      <div className="layers-panel-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-[13px] text-[var(--text-3)]">
            {searching ? "No files match." : "No tagged files yet."}
          </p>
        ) : (
          visible.map((layer) => {
            const open = openTags.has(layer.tag);
            const color = TAG_COLORS[layer.tag];
            return (
              <section key={layer.tag} className="mb-0.5">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onToggleTag(layer.tag)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--surface)]"
                >
                  <Chevron open={open} reduced={reduced} />
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                  />
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text)]">
                    {layer.tag}
                  </span>
                  <span className="ml-auto text-[12px] tabular-nums text-[var(--text-3)]">
                    {layer.files.length}
                  </span>
                </button>
                <div
                  className="grid"
                  style={{
                    gridTemplateRows: open ? "1fr" : "0fr",
                    transition: reduced ? undefined : "grid-template-rows 150ms var(--ease-repolens)",
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <ul className="pl-6">
                      {layer.files.map((file) => {
                        const selected = selectedId === file.id;
                        const name = file.name || fileName(file.path);
                        return (
                          <li key={file.id}>
                            <button
                              type="button"
                              aria-current={selected ? "true" : undefined}
                              onClick={() => onSelect(file.id)}
                              onMouseEnter={() => onHover(file.id)}
                              onMouseLeave={() => onHover(null)}
                              onFocus={() => onHover(file.id)}
                              onBlur={() => onHover(null)}
                              className="relative flex w-full cursor-pointer flex-col items-start rounded-[8px] py-1.5 pr-2 pl-3 text-left"
                              style={{
                                background: selected ? "var(--surface-2)" : undefined,
                                boxShadow: selected ? `inset 2px 0 0 ${color}` : undefined,
                              }}
                            >
                              <span className="mono w-full truncate text-[13px] leading-tight text-[var(--text)]">
                                {highlightMatch(name, q)}
                              </span>
                              <span className="w-full truncate text-[12px] leading-tight text-[var(--text-2)]">
                                {highlightMatch(file.role, q)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </section>
            );
          })
        )}
      </div>
      {footer ? <div className="flex-none px-4 py-3">{footer}</div> : null}
    </aside>
  );
}

interface ChevronProps {
  open: boolean;
  reduced: boolean;
}

function Chevron({ open, reduced }: ChevronProps) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-[var(--text-3)]"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: reduced ? undefined : "transform 150ms var(--ease-repolens)",
      }}
    >
      <path
        d="M3.2 1.6L7.2 5l-4 3.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  while (cursor < text.length) {
    const found = lower.indexOf(needle, cursor);
    if (found === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(
      <mark key={`${found}-${i}`} className="rounded-[2px] bg-[var(--surface-2)] text-[var(--api)]">
        {text.slice(found, found + q.length)}
      </mark>,
    );
    i += 1;
    cursor = found + needle.length;
  }
  return parts;
}
