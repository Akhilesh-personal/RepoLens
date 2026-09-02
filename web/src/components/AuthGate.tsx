import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthMe } from "shared";
import { api } from "../lib/api";
import { RepoIndexProvider, useRepoIndex } from "./RepoIndexProvider";
import { InternalSubheader, Wordmark } from "./Wordmark";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "ready"; user: AuthMe };

const AuthContext = createContext<{
  user: AuthMe;
  logout: () => Promise<void>;
  syncing: boolean;
  refreshRepos: () => Promise<void>;
} | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [syncing, setSyncing] = useState(true);

  const refreshRepos = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await api("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error("Could not refresh repositories.");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api("/api/auth/me")
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "anonymous" });
          return;
        }
        if (!res.ok) throw new Error("Could not check session");
        const user = (await res.json()) as AuthMe;
        if (!cancelled) setState({ status: "ready", user });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    void refreshRepos().catch(() => {
      /* Home shows an empty or error state after syncing ends */
    });
  }, [state.status, refreshRepos]);

  async function logout(): Promise<void> {
    await api("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  switch (state.status) {
    case "loading":
      return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--void)]">
          <Wordmark />
        </main>
      );
    case "anonymous":
      return <ConnectScreen />;
    case "ready":
      return (
        <AuthContext.Provider value={{ user: state.user, logout, syncing, refreshRepos }}>
          <RepoIndexProvider syncing={syncing}>
            <UserMenu
              user={state.user}
              syncing={syncing}
              onLogout={logout}
              onRefresh={() => {
                void refreshRepos().catch(() => {
                  /* ignore */
                });
              }}
            />
            {children}
          </RepoIndexProvider>
        </AuthContext.Provider>
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function ConnectScreen() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--void)]">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1>
          <Wordmark />
        </h1>
        <InternalSubheader />
        <a
          href={`${import.meta.env.VITE_API_URL ?? ""}/api/auth/login`}
          className="mt-10 inline-flex items-center justify-center rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-2)] px-3.5 py-2 text-[13px] font-medium text-[var(--text)] transition-colors duration-150 hover:border-[var(--hairline-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--api)]"
        >
          Continue with GitHub
        </a>
      </div>
    </main>
  );
}

interface UserMenuProps {
  user: AuthMe;
  syncing: boolean;
  onLogout: () => void;
  onRefresh: () => void;
}

function UserMenu({ user, syncing, onLogout, onRefresh }: UserMenuProps) {
  const { queue } = useRepoIndex();
  const showQueue = queue.total > 0;
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-3">
      {showQueue ? (
        <p className="text-[12px] text-[var(--text-3)]">
          Indexing {queue.done.toLocaleString()} of {queue.total.toLocaleString()} repositories
        </p>
      ) : null}
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--void-2)] px-2.5 py-1.5 text-[13px] text-[var(--text-2)] hover:border-[var(--hairline-2)] hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 rounded-full"
          />
        ) : (
          <span className="h-5 w-5 rounded-full bg-[var(--surface-2)]" />
        )}
        <span className="max-w-[10rem] truncate">{user.login}</span>
      </summary>
      <div className="mt-2 overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--void-2)]">
        <button
          type="button"
          disabled={syncing}
          onClick={onRefresh}
          className="block w-full px-3 py-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-50"
        >
          Refresh repositories
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="block w-full px-3 py-2 text-left text-[13px] text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          Log out
        </button>
      </div>
    </details>
    </div>
  );
}
