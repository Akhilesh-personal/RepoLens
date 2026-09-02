import pLimit from "p-limit";
import type { IndexQueueState, IndexStatus, RepoIndexProgress } from "shared";
import { accessTokenForRepo } from "./access.js";
import { query, queryOne } from "./db.js";
import {
  fetchHeadSha,
  getRateLimitResumeAt,
  isGithubRateLimitError,
} from "./github.js";
import { indexRepoById } from "./indexer.js";

type Job = {
  repoId: number;
  size: number;
};

const pending: Job[] = [];
const pendingIds = new Set<number>();
const indexingIds = new Set<number>();
const failed = new Map<number, string>();
const progress = new Map<number, RepoIndexProgress>();

let waveDone = 0;
let waveTotal = 0;

const limit = pLimit(1);

function githubSize(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dequeueSmallest(): Job | null {
  if (pending.length === 0) return null;
  pending.sort((a, b) => a.size - b.size || a.repoId - b.repoId);
  const job = pending.shift();
  if (!job) return null;
  pendingIds.delete(job.repoId);
  return job;
}

function enqueueInternal(repoId: number, size: number, bumpWave: boolean): void {
  const nextSize = githubSize(size);
  if (indexingIds.has(repoId)) return;
  if (pendingIds.has(repoId)) {
    const existing = pending.find((job) => job.repoId === repoId);
    if (existing) existing.size = nextSize;
    return;
  }
  failed.delete(repoId);
  pendingIds.add(repoId);
  pending.push({ repoId, size: nextSize });
  if (bumpWave) waveTotal += 1;
  void limit(processNext);
}

async function processNext(): Promise<void> {
  const job = dequeueSmallest();
  if (!job) return;

  indexingIds.add(job.repoId);
  progress.set(job.repoId, { done: 0, total: 0 });

  let counted = false;
  let requeue = false;
  try {
    const running = await queryOne<{ id: number }>(
      `SELECT id FROM index_runs WHERE repo_id = ? AND status = 'running' LIMIT 1`,
      [job.repoId],
    );
    if (running) return;

    const token = await accessTokenForRepo(job.repoId);
    counted = true;
    await indexRepoById(job.repoId, token, (done, total) => {
      progress.set(job.repoId, { done, total });
    });
    failed.delete(job.repoId);
  } catch (err: unknown) {
    if (isGithubRateLimitError(err)) {
      requeue = true;
      counted = false;
      console.log(`[index] repo ${job.repoId} rate limited; returning to queue`);
    } else {
      counted = true;
      const message = err instanceof Error ? err.message : String(err);
      failed.set(job.repoId, message);
      console.error(`[index] repo ${job.repoId} failed: ${message}`);
    }
  } finally {
    indexingIds.delete(job.repoId);
    progress.delete(job.repoId);
    if (requeue) {
      enqueueInternal(job.repoId, job.size, false);
    }
    if (counted) {
      waveDone += 1;
    } else if (!requeue) {
      waveTotal = Math.max(0, waveTotal - 1);
    }
    if (pendingIds.size === 0 && indexingIds.size === 0) {
      waveDone = 0;
      waveTotal = 0;
    }
  }
}

export function enqueue(repoId: number, size = 0): void {
  enqueueInternal(repoId, size, true);
}

export function getStatus(repoId: number): IndexStatus {
  const paused = getRateLimitResumeAt() != null;
  if (paused && (indexingIds.has(repoId) || pendingIds.has(repoId))) return "waiting";
  if (indexingIds.has(repoId)) return "indexing";
  if (pendingIds.has(repoId)) return "queued";
  if (failed.has(repoId)) return "failed";
  return "indexed";
}

export function getProgress(repoId: number): RepoIndexProgress | null {
  return progress.get(repoId) ?? null;
}

export function getError(repoId: number): string | null {
  return failed.get(repoId) ?? null;
}

export function getQueueState(): IndexQueueState {
  if (waveTotal === 0) return { done: 0, total: 0 };
  return { done: waveDone, total: waveTotal };
}

export async function enqueueUnindexedRepos(): Promise<number> {
  const rows = await query<{ id: number; github_size: number | string }>(
    `SELECT id, github_size FROM repos WHERE last_indexed_sha IS NULL`,
  );
  for (const row of rows) enqueue(row.id, githubSize(row.github_size));
  return rows.length;
}

export async function enqueueUnindexedForUser(userId: number): Promise<number> {
  const rows = await query<{ id: number; github_size: number | string }>(
    `SELECT r.id, r.github_size
     FROM repos r
     INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
     WHERE r.last_indexed_sha IS NULL`,
    [userId],
  );
  for (const row of rows) enqueue(row.id, githubSize(row.github_size));
  return rows.length;
}

export async function enqueueChangedRepos(): Promise<number> {
  const repos = await query<{
    id: number;
    owner: string;
    name: string;
    default_branch: string;
    last_indexed_sha: string | null;
    github_size: number | string;
  }>(
    `SELECT id, owner, name, default_branch, last_indexed_sha, github_size FROM repos`,
  );

  let enqueued = 0;
  for (const repo of repos) {
    let token: string;
    try {
      token = await accessTokenForRepo(repo.id);
    } catch {
      continue;
    }
    try {
      const head = await fetchHeadSha(token, repo.owner, repo.name, repo.default_branch);
      if (head !== repo.last_indexed_sha) {
        enqueue(repo.id, githubSize(repo.github_size));
        enqueued += 1;
      }
    } catch (err: unknown) {
      if (isGithubRateLimitError(err)) {
        console.log(`[index] sha check rate limited; remaining repos will wait`);
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[index] sha check failed for ${repo.owner}/${repo.name}: ${message}`);
    }
  }
  return enqueued;
}
