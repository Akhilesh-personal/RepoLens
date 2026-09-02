import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "./ui/Badge";
import {
  cx,
  formatRelative,
  primaryTag,
  tagColor,
  type FileDetail,
  type Neighbour,
} from "shared";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { api } from "../lib/api";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const DETAIL_PANEL_WIDTH = 440;

interface DetailPanelProps {
  fileId: string | null;
  lastIndexedAt?: string | null;
  onClose: () => void;
  onFocusFile: (id: string) => void;
  onHoverNeighbour: (id: string | null) => void;
}

export function DetailPanel({
  fileId,
  lastIndexedAt,
  onClose,
  onFocusFile,
  onHoverNeighbour,
}: DetailPanelProps) {
  const reduced = usePrefersReducedMotion();
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!fileId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    api(`/api/files/${fileId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load this file.");
        return res.json() as Promise<FileDetail>;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, retry]);

  const tag = primaryTag(detail?.tags);
  const accent = tagColor(tag);
  const unavailable = detail?.role === "Unavailable";

  async function copyPath() {
    if (!detail) return;
    await navigator.clipboard.writeText(detail.path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <AnimatePresence>
      {fileId ? (
        <motion.aside
          key="file-panel"
          role="dialog"
          aria-label="File details"
          initial={reduced ? { opacity: 0 } : { x: 24, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { x: 24, opacity: 0 }}
          transition={
            reduced
              ? { duration: 0.15, ease: EASE }
              : { duration: 0.2, ease: EASE }
          }
          className="panel-surface fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] w-full flex-col overflow-hidden border-t border-[var(--hairline)] md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[440px] md:border-l md:border-t-0"
          style={{
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
          }}
        >
          <div className="absolute inset-y-0 left-0 w-[2px]" style={{ background: accent }} />
          <div className="flex items-center justify-between px-6 pt-5">
            <p className="label">File</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] text-[var(--text-3)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3.2 3.2l7.6 7.6M10.8 3.2l-7.6 7.6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-8 pt-4">
            <AnimatePresence mode="wait">
              {!detail && !error ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="space-y-4"
                >
                  <div className="relative h-7 overflow-hidden rounded-[10px] bg-[var(--surface)]">
                    <div className="skeleton-sheen absolute inset-0" />
                  </div>
                  <div className="relative h-4 w-2/3 overflow-hidden rounded-[10px] bg-[var(--surface)]">
                    <div className="skeleton-sheen absolute inset-0" />
                  </div>
                  <div className="relative h-24 overflow-hidden rounded-[16px] bg-[var(--surface)]">
                    <div className="skeleton-sheen absolute inset-0" />
                  </div>
                </motion.div>
              ) : error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="py-10 text-center"
                >
                  <p className="text-[var(--text-2)]">{error}</p>
                  <button
                    type="button"
                    className="mt-4 rounded-[10px] border border-[var(--hairline)] px-3 py-1.5 text-[13px]"
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    Retry
                  </button>
                </motion.div>
              ) : detail ? (
                <motion.div
                  key={detail.path}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0.15 : 0.2, ease: EASE }}
                  className="space-y-6"
                >
                <Stagger reduced={reduced} index={0}>
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: accent, boxShadow: `0 0 12px ${accent}` }}
                    />
                    <h2 className="text-[24px] font-semibold leading-tight tracking-tight">
                      {detail.role}
                    </h2>
                  </div>
                </Stagger>
                <Stagger reduced={reduced} index={1}>
                  <button
                    type="button"
                    onClick={() => void copyPath()}
                    className="mono block max-w-full truncate text-left text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)]"
                    title="Copy path"
                  >
                    {detail.path}
                    <span className="ml-2 text-[10px] uppercase tracking-[0.14em]">
                      {copied ? "copied" : "copy"}
                    </span>
                  </button>
                </Stagger>
                <Stagger reduced={reduced} index={2}>
                  <p
                    className={cx(
                      "text-[15px] leading-[1.65] text-[var(--text-2)]",
                      unavailable && "italic text-[var(--text-3)]",
                    )}
                  >
                    {detail.summary}
                  </p>
                </Stagger>
                {detail.key_exports.length > 0 ? (
                  <Stagger reduced={reduced} index={3}>
                    <p className="label mb-2">Exports</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.key_exports.map((name) => (
                        <Badge key={name} tag={tag}>
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </Stagger>
                ) : null}
                <Stagger reduced={reduced} index={4}>
                  <NeighbourList
                    title="Imports"
                    items={detail.imports}
                    onFocusFile={onFocusFile}
                    onHoverNeighbour={onHoverNeighbour}
                  />
                </Stagger>
                <Stagger reduced={reduced} index={5}>
                  <NeighbourList
                    title="Imported by"
                    items={detail.importedBy}
                    onFocusFile={onFocusFile}
                    onHoverNeighbour={onHoverNeighbour}
                  />
                </Stagger>
                <Stagger reduced={reduced} index={6}>
                  <footer className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[11px] text-[var(--text-3)]">
                    <span>{detail.language ?? "unknown"}</span>
                    <span>{formatBytes(detail.sizeBytes)}</span>
                    <span>indexed {formatRelative(lastIndexedAt ?? detail.updatedAt)}</span>
                  </footer>
                </Stagger>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

interface StaggerProps {
  children: ReactNode;
  index: number;
  reduced: boolean;
}

function Stagger({ children, index, reduced }: StaggerProps) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, filter: "blur(6px)" }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.4, delay: reduced ? 0 : index * 0.04, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

interface NeighbourListProps {
  title: string;
  items: Neighbour[];
  onFocusFile: (id: string) => void;
  onHoverNeighbour: (id: string | null) => void;
}

function NeighbourList({
  title,
  items,
  onFocusFile,
  onHoverNeighbour,
}: NeighbourListProps) {
  return (
    <div>
      <p className="label mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--text-3)]">None</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const color = tagColor(primaryTag(item.tags));
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--surface)]"
                  onMouseEnter={() => onHoverNeighbour(item.id)}
                  onMouseLeave={() => onHoverNeighbour(null)}
                  onFocus={() => onHoverNeighbour(item.id)}
                  onBlur={() => onHoverNeighbour(null)}
                  onClick={() => onFocusFile(item.id)}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="mono truncate text-[12px] text-[var(--text)]">{item.name}</span>
                  <span className="ml-auto truncate text-[12px] text-[var(--text-3)]">{item.role}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
