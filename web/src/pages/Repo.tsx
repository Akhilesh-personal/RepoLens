import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Constellation } from "../components/Constellation";
import { DETAIL_PANEL_WIDTH, DetailPanel } from "../components/DetailPanel";
import {
  fileMatchesQuery,
  groupLayers,
  LayersPanel,
  LAYERS_PANEL_WIDTH,
} from "../components/LayersPanel";
import { OverviewDrawer } from "../components/OverviewDrawer";
import { TreeView } from "../components/TreeView";
import { Wordmark } from "../components/Wordmark";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { useIsMobile } from "../components/usePrefersReducedMotion";
import { api } from "../lib/api";
import { parseRepoListResponse } from "../lib/repos";
import {
  repoSlug,
  type GraphResponse,
  type IndexStatus,
  type RepoListItem,
  type TagKey,
  type TreeNode,
  type TreeResponse,
} from "shared";

export default function RepoPage() {
  const { owner = "", name = "" } = useParams<{ owner: string; name: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const slug = repoSlug(owner, name);
  const fileParam = search.get("file");
  const mobile = useIsMobile();

  const [repo, setRepo] = useState<RepoListItem | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [view, setView] = useState<"constellation" | "tree">("constellation");
  const [openTags, setOpenTags] = useState<Set<TagKey>>(() => new Set());
  const [query, setQuery] = useState("");
  const savedOpenRef = useRef<Set<TagKey> | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = fileParam;

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api("/api/repos").then(async (res) => {
        const data: unknown = await res.json();
        return parseRepoListResponse(data).repos;
      }),
      api(`/api/repos/${slug}/graph`).then(async (res) => {
        if (!res.ok) throw new Error("This repository has not been indexed yet.");
        return res.json() as Promise<GraphResponse>;
      }),
      api(`/api/repos/${slug}/tree`).then((res) => res.json() as Promise<TreeResponse>),
    ])
      .then(([repos, graphPayload, treePayload]) => {
        const nodes = graphPayload.nodes ?? [];
        const edges = graphPayload.edges ?? [];
        console.log("[graph] nodes", nodes.length, "edges", edges.length);
        console.log("[graph] sample", nodes.slice(0, 3));
        const found = repos.find((item) => item.slug === slug) ?? null;
        setRepo(found);
        setGraph(graphPayload);
        setTree(treePayload.tree ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load repository.");
      });
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setOpenTags(new Set());
    setQuery("");
    savedOpenRef.current = null;
    setOverviewOpen(false);
    setHoveredId(null);
  }, [slug]);

  useEffect(() => {
    if (
      repo?.indexStatus !== "queued" &&
      repo?.indexStatus !== "indexing" &&
      repo?.indexStatus !== "waiting" &&
      !repo?.indexing
    ) {
      return;
    }
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [repo?.indexStatus, repo?.indexing, load]);

  const select = useCallback(
    (id: string) => {
      navigate(`/repo/${slug}?file=${encodeURIComponent(id)}`, { replace: true });
    },
    [navigate, slug],
  );

  const closePanel = useCallback(() => {
    navigate(`/repo/${slug}`, { replace: true });
    setHoveredId(null);
  }, [navigate, slug]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closePanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel]);

  const layers = useMemo(() => groupLayers(graph?.nodes ?? []), [graph]);

  const handleQueryChange = useCallback(
    (next: string) => {
      const was = query.trim();
      const now = next.trim();
      setQuery(next);
      if (!was && now) savedOpenRef.current = new Set(openTags);
      if (was && !now) {
        setOpenTags(savedOpenRef.current ?? new Set());
        savedOpenRef.current = null;
        return;
      }
      if (now) {
        const matching = new Set<TagKey>();
        for (const layer of layers) {
          if (layer.files.some((file) => fileMatchesQuery(file, now))) matching.add(layer.tag);
        }
        setOpenTags(matching);
      }
    },
    [query, openTags, layers],
  );

  const toggleTag = useCallback((tag: TagKey) => {
    setOpenTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const empty = (graph?.nodes.length ?? 0) === 0;
  const showTree = view === "tree";
  const panelOpen = Boolean(selectedId);

  function flyToPath(path: string) {
    const node = graph?.nodes.find((item) => item.path === path);
    if (node) select(node.id);
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="text-[var(--text-2)]">{error}</p>
          <Button className="mt-6" onClick={load}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (!repo || !graph) {
    return (
      <main className="min-h-screen p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-[70vh] w-full" />
      </main>
    );
  }

  const panelHeader = (
    <>
      <Link to="/" className="hover:text-[var(--text-2)]">
        <Wordmark variant="header" />
      </Link>
      <h1 className="mt-1 text-[18px] font-semibold tracking-tight">{repo.name}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!mobile ? (
          <div className="flex rounded-[10px] border border-[var(--hairline)] bg-[var(--void-2)] p-0.5">
            <Toggle
              active={view === "constellation"}
              onClick={() => setView("constellation")}
              label="Constellation"
            />
            <Toggle active={view === "tree"} onClick={() => setView("tree")} label="Tree" />
          </div>
        ) : null}
        <StatusPill
          status={repo.indexStatus}
          indexing={repo.indexing}
          current={Boolean(repo.lastIndexedAt) && repo.indexStatus === "indexed"}
        />
      </div>
    </>
  );

  return (
    <main className="relative h-screen overflow-hidden bg-[var(--void)]">
      {showTree ? (
        <div
          className="absolute inset-0 overflow-auto pt-4"
          style={{
            left: mobile ? 0 : LAYERS_PANEL_WIDTH,
            right: panelOpen && !mobile ? DETAIL_PANEL_WIDTH : 0,
            paddingLeft: mobile ? 16 : 24,
            paddingRight: 24,
          }}
        >
          {empty ? <EmptyState /> : <TreeView tree={tree} selectedId={selectedId} onSelect={select} />}
        </div>
      ) : (
        <div className="absolute inset-0">
          <Constellation
            data={graph}
            empty={empty}
            interactive={!empty}
            nodePicking={false}
            ambient={!empty}
            selectedId={selectedId}
            hoveredId={hoveredId}
            highlightTags={openTags}
            onHover={setHoveredId}
            onReset={closePanel}
          />
          {empty ? (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={{ paddingLeft: mobile ? 0 : LAYERS_PANEL_WIDTH }}
            >
              <EmptyState />
            </div>
          ) : null}
        </div>
      )}

      <div
        className={`absolute bottom-0 left-0 top-0 z-30 flex ${mobile ? "w-full" : ""}`}
        style={{ width: mobile ? undefined : LAYERS_PANEL_WIDTH }}
      >
        <LayersPanel
          nodes={graph.nodes}
          selectedId={selectedId}
          openTags={openTags}
          query={query}
          onQueryChange={handleQueryChange}
          onToggleTag={toggleTag}
          onSelect={select}
          onHover={setHoveredId}
          header={panelHeader}
        />
      </div>

      <OverviewDrawer
        overview={repo.overview}
        open={overviewOpen}
        onOpen={() => setOverviewOpen(true)}
        onClose={() => setOverviewOpen(false)}
        onPath={flyToPath}
      />

      <DetailPanel
        fileId={selectedId}
        lastIndexedAt={repo.lastIndexedAt}
        onClose={closePanel}
        onFocusFile={select}
        onHoverNeighbour={setHoveredId}
      />
    </main>
  );
}

function EmptyState() {
  return (
    <div className="pointer-events-auto max-w-md px-6 text-center">
      <p className="text-[20px] font-medium">Nothing indexed yet</p>
      <p className="mt-3 text-[var(--text-2)]">Start the worker to assemble this constellation.</p>
      <pre className="mono mt-5 rounded-[16px] border border-[var(--hairline)] bg-[var(--void-2)] px-4 py-3 text-[13px]">
        npm run worker
      </pre>
    </div>
  );
}

interface ToggleProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function Toggle({ active, onClick, label }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[8px] px-3 py-1.5 text-[12px] ${
        active ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--text-3)]"
      }`}
    >
      {label}
    </button>
  );
}

interface StatusPillProps {
  status: IndexStatus;
  indexing: boolean;
  current: boolean;
}

function StatusPill({ status, indexing, current }: StatusPillProps) {
  let color = "var(--text-3)";
  let label = "Idle";
  switch (status) {
    case "failed":
      color = "var(--text-3)";
      label = "Failed";
      break;
    case "queued":
      color = "var(--text-3)";
      label = "Queued";
      break;
    case "waiting":
      color = "var(--config)";
      label = "Waiting";
      break;
    case "indexing":
      color = "var(--config)";
      label = "Indexing";
      break;
    case "indexed":
      color = current ? "var(--data)" : "var(--text-3)";
      label = current ? "Current" : "Idle";
      break;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
  if (indexing && status !== "waiting" && status !== "failed") {
    color = "var(--config)";
    label = "Indexing";
  }
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--void-2)] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--text-3)]">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 8px ${color}`,
          animation: indexing ? "pulse 2.4s var(--ease-repolens) infinite" : undefined,
        }}
      />
      {label}
    </div>
  );
}
