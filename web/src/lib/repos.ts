import type { IndexQueueState, RepoListItem, RepoListResponse } from "shared";

const EMPTY_QUEUE: IndexQueueState = { done: 0, total: 0 };

export function parseRepoListResponse(data: unknown): RepoListResponse {
  if (Array.isArray(data)) {
    return { repos: data as RepoListItem[], queue: EMPTY_QUEUE };
  }
  if (data && typeof data === "object" && "repos" in data) {
    const body = data as RepoListResponse;
    return {
      repos: body.repos ?? [],
      queue: body.queue ?? EMPTY_QUEUE,
    };
  }
  return { repos: [], queue: EMPTY_QUEUE };
}

export function hasActiveIndexJobs(repos: RepoListItem[]): boolean {
  return repos.some(
    (repo) =>
      repo.indexStatus === "queued" ||
      repo.indexStatus === "indexing" ||
      repo.indexStatus === "waiting",
  );
}
