import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import type { RepoOverview } from "shared";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SURFACE = {
  background: "rgba(10, 12, 18, 0.82)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

interface OverviewDrawerProps {
  overview: RepoOverview | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPath: (path: string) => void;
}

export function OverviewDrawer({
  overview,
  open,
  onOpen,
  onClose,
  onPath,
}: OverviewDrawerProps) {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!overview) return null;

  const enter = reduced ? 0.15 : 0.4;
  const leave = reduced ? 0.15 : 0.2;

  return (
    <>
      {!open ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pt-6">
          <button
            type="button"
            onClick={onOpen}
            className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-[var(--hairline)] px-4 py-2 text-[var(--text-3)] transition-colors duration-150 hover:border-[var(--hairline-2)] hover:bg-[rgba(255,255,255,0.04)]"
            style={SURFACE}
            aria-expanded={false}
            aria-controls="overview-panel"
          >
            <span className="text-[11px] font-medium uppercase tracking-[0.14em]">Overview</span>
            <Chevron />
          </button>
        </div>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            key="overview"
            className="fixed inset-0 z-[45]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: leave, ease: EASE } }}
            transition={{ duration: enter, ease: EASE }}
          >
            <button
              type="button"
              aria-label="Collapse overview"
              className="absolute inset-0 cursor-default bg-[rgba(5,6,10,0.5)]"
              onClick={onClose}
            />
            <motion.div
              id="overview-panel"
              role="dialog"
              aria-label="Repository overview"
              className="absolute left-1/2 top-6 flex max-h-[70vh] w-[min(720px,calc(100vw-96px))] flex-col overflow-hidden rounded-[16px] border border-[var(--hairline)]"
              style={{ ...SURFACE, transformOrigin: "top center" }}
              initial={reduced ? { opacity: 0, x: "-50%" } : { opacity: 0, scale: 0.98, x: "-50%" }}
              animate={reduced ? { opacity: 1, x: "-50%" } : { opacity: 1, scale: 1, x: "-50%" }}
              exit={
                reduced
                  ? { opacity: 0, x: "-50%", transition: { duration: leave, ease: EASE } }
                  : {
                      opacity: 0,
                      scale: 0.98,
                      x: "-50%",
                      transition: { duration: leave, ease: EASE },
                    }
              }
              transition={{ duration: enter, ease: EASE }}
            >
              <header className="flex flex-none items-center justify-between px-4 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]">
                  Overview
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close overview"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] text-[var(--text-3)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  <CloseIcon />
                </button>
              </header>
              <div
                className="overview-drawer-body px-5 pb-6"
                style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
              >
                <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-2">
                  <section>
                    <p className="label mb-2">Overview</p>
                    <p className="text-[14px] leading-[1.65] text-[var(--text-2)]">
                      {overview.what_it_is}
                    </p>
                  </section>
                  <section>
                    <p className="label mb-2">Stack</p>
                    <p className="text-[13px] leading-[1.65] text-[var(--text-2)]">
                      {overview.stack.join(" · ")}
                    </p>
                  </section>
                  <section>
                    <p className="label mb-2">How it works</p>
                    <p className="text-[14px] leading-[1.65] text-[var(--text-2)]">
                      {overview.how_it_works}
                    </p>
                  </section>
                  <section>
                    <p className="label mb-2">Start here</p>
                    <ul className="space-y-1">
                      {overview.start_here.map((path) => (
                        <li key={path}>
                          <button
                            type="button"
                            className="mono text-left text-[12px] text-[var(--api)] hover:text-[var(--text)]"
                            onClick={() => {
                              onPath(path);
                              onClose();
                            }}
                          >
                            {path}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className="text-[var(--text-3)]"
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3.2 3.2l7.6 7.6M10.8 3.2l-7.6 7.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
