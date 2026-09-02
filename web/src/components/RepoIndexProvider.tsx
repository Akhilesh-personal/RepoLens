import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { IndexQueueState, RepoListItem } from "shared";
import { api } from "../lib/api";
import { hasActiveIndexJobs, parseRepoListResponse } from "../lib/repos";

type RepoIndexContextValue = {
  repos: RepoListItem[] | null;
  queue: IndexQueueState;
  error: string | null;
  reload: () => void;
};

const RepoIndexContext = createContext<RepoIndexContextValue | null>(null);

export function useRepoIndex(): RepoIndexContextValue {
  const ctx = useContext(RepoIndexContext);
  if (!ctx) throw new Error("useRepoIndex must be used within RepoIndexProvider");
  return ctx;
}

interface RepoIndexProviderProps {
  syncing: boolean;
  children: ReactNode;
}

export function RepoIndexProvider({ syncing, children }: RepoIndexProviderProps) {
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);
  const [queue, setQueue] = useState<IndexQueueState>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const reposRef = useRef(repos);
  reposRef.current = repos;

  const load = useCallback((silent: boolean) => {
    if (!silent) setError(null);
    api("/api/repos")
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load repositories.");
        return res.json() as Promise<unknown>;
      })
      .then((data) => {
        const parsed = parseRepoListResponse(data);
        setRepos(parsed.repos);
        setQueue(parsed.queue);
        setError(null);
      })
      .catch((err: unknown) => {
        if (reposRef.current) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      });
  }, []);

  useEffect(() => {
    if (syncing) return;
    load(Boolean(reposRef.current));
  }, [syncing, load]);

  const active = Boolean(repos && hasActiveIndexJobs(repos));

  useEffect(() => {
    if (syncing || !active) return;
    const id = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(id);
  }, [active, syncing, load]);

  const reload = useCallback(() => load(true), [load]);

  return (
    <RepoIndexContext.Provider value={{ repos, queue, error, reload }}>
      {children}
    </RepoIndexContext.Provider>
  );
}
