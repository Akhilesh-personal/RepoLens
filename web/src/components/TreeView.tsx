import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { cx, primaryTag, tagColor, type TreeNode } from "shared";

interface TreeViewProps {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface FlatRow {
  id: string;
  entry: TreeNode;
  depth: number;
}

export function TreeView({ tree, selectedId, onSelect }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const next = new Set<string>();
    for (const node of tree) {
      if (node.type === "folder") next.add(node.path);
    }
    setExpanded(next);
  }, [tree]);

  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  useEffect(() => {
    if (selectedId) {
      const idx = rows.findIndex((row) => row.entry.id === selectedId);
      if (idx >= 0) setCursor(idx);
    }
  }, [selectedId, rows]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === "ArrowRight") {
      const row = rows[cursor];
      if (row?.entry.type === "folder" && !expanded.has(row.entry.path)) {
        event.preventDefault();
        toggle(row.entry.path);
      }
    } else if (event.key === "ArrowLeft") {
      const row = rows[cursor];
      if (row?.entry.type === "folder" && expanded.has(row.entry.path)) {
        event.preventDefault();
        toggle(row.entry.path);
      }
    } else if (event.key === "Enter") {
      const row = rows[cursor];
      if (!row) return;
      event.preventDefault();
      if (row.entry.type === "folder") toggle(row.entry.path);
      else if (row.entry.id) onSelect(row.entry.id);
    }
  }

  return (
    <div
      className="h-full overflow-auto px-4 py-6 outline-none"
      tabIndex={0}
      role="tree"
      aria-label="Repository tree"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => {
        const isFolder = row.entry.type === "folder";
        const isOpen = isFolder && expanded.has(row.entry.path);
        const isSelected = row.entry.id === selectedId;
        const isCursor = index === cursor;
        const color = tagColor(primaryTag(row.entry.tags));
        return (
          <div
            key={row.id}
            role="treeitem"
            aria-expanded={isFolder ? isOpen : undefined}
            aria-selected={isSelected}
            className={cx(
              "flex cursor-pointer items-start gap-2 rounded-[10px] px-2 py-1.5 transition-[background,opacity] duration-150",
              isSelected && "bg-[var(--surface-2)]",
              isCursor && !isSelected && "bg-[var(--surface)]",
            )}
            style={{ paddingLeft: 8 + row.depth * 16 }}
            onClick={() => {
              setCursor(index);
              if (isFolder) toggle(row.entry.path);
              else if (row.entry.id) onSelect(row.entry.id);
            }}
          >
            <span className="mt-1 w-3 text-[10px] text-[var(--text-3)]">
              {isFolder ? (isOpen ? "▾" : "▸") : ""}
            </span>
            {!isFolder ? (
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            ) : (
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--hairline-2)]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={cx(isFolder ? "font-medium text-[var(--text)]" : "mono text-[13px] text-[var(--text)]")}>
                  {row.entry.name}
                </span>
                {!isFolder && row.entry.role ? (
                  <span className="truncate text-[12px] text-[var(--text-3)]">{row.entry.role}</span>
                ) : null}
              </div>
              {isFolder && row.entry.gloss ? (
                <p className="text-[13px] leading-snug text-[var(--text-2)]">{row.entry.gloss}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function flatten(tree: TreeNode[], expanded: Set<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const entry of tree) {
    rows.push({ id: `${entry.type}:${entry.path}`, entry, depth });
    if (entry.type === "folder" && expanded.has(entry.path) && entry.children) {
      rows.push(...flatten(entry.children, expanded, depth + 1));
    }
  }
  return rows;
}
