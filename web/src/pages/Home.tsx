import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Lenis from "lenis";
import { motion } from "motion/react";
import { Constellation } from "../components/Constellation";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { usePrefersReducedMotion } from "../components/usePrefersReducedMotion";
import { useAuth } from "../components/AuthGate";
import { useRepoIndex } from "../components/RepoIndexProvider";
import { Tagline, Wordmark } from "../components/Wordmark";
import { api } from "../lib/api";
import {
  formatRelative,
  LEGEND_TAGS,
  TAG_COLORS,
  type GraphResponse,
  type IndexStatus,
  type RepoListItem,
} from "shared";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function HomePage() {
  const reduced = usePrefersReducedMotion();
  const { refreshRepos } = useAuth();
  const { repos, error, reload } = useRepoIndex();
  const [graphs, setGraphs] = useState<GraphResponse | null>(null);
  const indexedKey = useMemo(
    () =>
      (repos ?? [])
        .filter((repo) => repo.indexStatus === "indexed" && repo.summaryCount > 0)
        .map((repo) => repo.slug)
        .join("|"),
    [repos],
  );

  useEffect(() => {
    if (!indexedKey) {
      setGraphs({ nodes: [], edges: [] });
      return;
    }
    const slugs = indexedKey.split("|").filter(Boolean);
    let cancelled = false;
    void Promise.all(
      slugs.map((slug) =>
        api(`/api/repos/${slug}/graph`).then((res) => res.json() as Promise<GraphResponse>),
      ),
    ).then((payloads) => {
      if (!cancelled) setGraphs(mergeGraphs(payloads));
    });
    return () => {
      cancelled = true;
    };
  }, [indexedKey]);

  useEffect(() => {
    const lenis = new Lenis({
      lerp: reduced ? 1 : 0.08,
      syncTouch: true,
    });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [reduced]);

  const atmosphereEmpty = (repos ?? []).every(
    (repo) => repo.indexStatus !== "indexed" || repo.summaryCount === 0,
  );

  return (
    <main className="relative min-h-screen">
      <section className="relative isolate min-h-screen overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-30">
          <Constellation data={graphs} atmosphere interactive={false} empty={atmosphereEmpty} />
        </div>
        <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col justify-end px-6 pb-20 pt-28 md:justify-center md:pb-28">
          <h1>
            <Wordmark />
          </h1>
          <Tagline />
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-28">
        {repos === null && !error ? (
          <div>
            <p className="mb-6 text-center text-[15px] text-[var(--text-2)]">
              Reading your repositories...
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          </div>
        ) : error && repos === null ? (
          <div className="mx-auto max-w-md py-20 text-center">
            <p className="text-[var(--text-2)]">{error}</p>
            <Button className="mt-6" onClick={() => void refreshRepos()}>
              Retry
            </Button>
          </div>
        ) : repos && repos.length === 0 ? (
          <div className="mx-auto max-w-lg py-8 text-center">
            <p className="text-[20px] font-medium">No repositories found</p>
            <Button className="mt-6" onClick={() => void refreshRepos()}>
              Refresh repositories
            </Button>
          </div>
        ) : repos ? (
          <div>
            <div className="mb-4 flex justify-end">
              <Button variant="quiet" onClick={() => void refreshRepos()}>
                Refresh repositories
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {repos.map((repo, index) => (
                <RepoCard
                  key={repo.slug}
                  repo={repo}
                  index={index}
                  reduced={reduced}
                  onRetry={reload}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

interface RepoCardProps {
  repo: RepoListItem;
  index: number;
  reduced: boolean;
  onRetry: () => void;
}

function RepoCard({ repo, index, reduced, onRetry }: RepoCardProps) {
  const status: IndexStatus = repo.indexStatus;
  const total = repo.tagSpectrum.reduce((sum, item) => sum + item.count, 0) || 1;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: EASE }}
    >
      {(() => {
        switch (status) {
          case "queued":
            return (
              <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-6 opacity-60">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">{repo.name}</h2>
                  <span className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-3)]" />
                    Queued
                  </span>
                </div>
                <p className="mt-3 min-h-[3.3em] text-[15px] leading-[1.65] text-[var(--text-2)]">
                  {repo.description ?? "Waiting to be indexed."}
                </p>
              </div>
            );
          case "waiting":
            return (
              <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">{repo.name}</h2>
                  <span className="flex items-center gap-2 text-[12px] text-[var(--config)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--config)]" />
                    Waiting
                  </span>
                </div>
                <p className="mt-3 min-h-[3.3em] text-[15px] leading-[1.65] text-[var(--text-2)]">
                  Waiting for GitHub rate limit - resumes in {formatResumeIn(repo.rateLimitResumeAt)}
                </p>
              </div>
            );
          case "indexing": {
            const done = repo.progress?.done ?? repo.summaryCount;
            const of = repo.progress?.total ?? repo.fileCount;
            const pct = of > 0 ? Math.min(100, (done / of) * 100) : 0;
            return (
              <div className="relative overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">{repo.name}</h2>
                  <span className="flex items-center gap-2 text-[12px] text-[var(--config)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--config)]" />
                    Indexing{" "}
                    {of > 0
                      ? `${done.toLocaleString()} of ${of.toLocaleString()}`
                      : "…"}
                  </span>
                </div>
                <p className="mt-3 min-h-[3.3em] text-[15px] leading-[1.65] text-[var(--text-2)]">
                  {repo.description ?? "Summaries are being written."}
                </p>
                <div
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--surface-2)]"
                  aria-hidden="true"
                >
                  <div
                    className="h-full bg-[var(--config)] transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          }
          case "failed":
            return (
              <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[20px] font-semibold tracking-tight">{repo.name}</h2>
                  <span className="text-[12px] text-[var(--text-3)]">Indexing failed</span>
                </div>
                <p className="mt-3 min-h-[3.3em] text-[15px] leading-[1.65] text-[var(--text-2)]">
                  {repo.indexError ?? "Indexing failed."}
                </p>
                <Button
                  className="mt-4"
                  variant="quiet"
                  onClick={() => {
                    void api(`/api/index/${repo.slug}`, { method: "POST" }).then(() => onRetry());
                  }}
                >
                  Retry
                </Button>
              </div>
            );
          case "indexed":
            return (
              <Link
                to={`/repo/${repo.slug}`}
                className="group relative block overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-6 transition-[transform,border-color] duration-150 hover:-translate-y-1 hover:border-[var(--hairline-2)]"
                onMouseMove={(event) => {
                  const el = event.currentTarget;
                  const rect = el.getBoundingClientRect();
                  el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
                  el.style.setProperty("--my", `${event.clientY - rect.top}px`);
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{
                    background:
                      "radial-gradient(240px circle at var(--mx) var(--my), rgba(255,255,255,0.07), transparent 55%)",
                  }}
                />
                <div className="relative">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[20px] font-semibold tracking-tight">{repo.name}</h2>
                    <span className="text-[12px] text-[var(--text-3)]">
                      {formatRelative(repo.lastIndexedAt)}
                    </span>
                  </div>
                  <p className="mt-3 min-h-[3.3em] text-[15px] leading-[1.65] text-[var(--text-2)]">
                    {repo.overview?.what_it_is ?? repo.description ?? "Not yet summarized."}
                  </p>
                  <div className="mt-5 flex h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    {(repo.tagSpectrum.length
                      ? repo.tagSpectrum
                      : LEGEND_TAGS.map((tag) => ({ tag, count: 0 }))
                    ).map((item) => (
                      <span
                        key={item.tag}
                        style={{
                          width: `${(item.count / total) * 100}%`,
                          background: TAG_COLORS[item.tag],
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-4 text-[12px] text-[var(--text-3)]">
                    {repo.fileCount.toLocaleString()} files
                  </p>
                </div>
              </Link>
            );
          default: {
            const exhaustive: never = status;
            return exhaustive;
          }
        }
      })()}
    </motion.div>
  );
}

function formatResumeIn(iso: string | null): string {
  if (!iso) return "soon";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))}s`;
  return `${Math.ceil(ms / 60_000)}m`;
}

function mergeGraphs(payloads: GraphResponse[]): GraphResponse {
  const nodes = payloads.flatMap((payload, i) =>
    payload.nodes.map((node) => ({
      ...node,
      id: `${i}:${node.id}`,
      folder: `${i}/${node.folder}`,
    })),
  );
  const edges = payloads.flatMap((payload, i) =>
    payload.edges.map((edge) => ({
      source: `${i}:${edge.source}`,
      target: `${i}:${edge.target}`,
    })),
  );
  return { nodes, edges };
}
