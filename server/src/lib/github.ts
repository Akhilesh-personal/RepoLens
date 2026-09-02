import "./env.js";
import { createHash } from "node:crypto";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Octokit } from "@octokit/rest";
import gunzipMaybe from "gunzip-maybe";
import pLimit from "p-limit";
import { extract as tarExtract } from "tar-stream";
import type { DiscoveredRepo, GitTreeBlob, RepoMeta } from "shared";
import { isBinaryBuffer, isBlockedPath, isTooLarge, maxFileBytes } from "./redact.js";

export type { DiscoveredRepo, GitTreeBlob, RepoMeta };

export type ArchivedFile = {
  content: string;
  size: number;
  sha: string;
};

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const githubLimit = pLimit(3);

let pauseUntil = 0;

export class GithubRateLimitError extends Error {
  readonly kind = "github_rate_limit" as const;
  readonly resumeAt: number;

  constructor(resumeAt: number) {
    super(`GitHub rate limit; resumes at ${new Date(resumeAt).toISOString()}`);
    this.name = "GithubRateLimitError";
    this.resumeAt = resumeAt;
  }
}

export class RepoTooLargeError extends Error {
  constructor() {
    super("repo too large");
    this.name = "RepoTooLargeError";
  }
}

export function isGithubRateLimitError(err: unknown): err is GithubRateLimitError {
  return Boolean(
    err &&
      typeof err === "object" &&
      "kind" in err &&
      (err as { kind: unknown }).kind === "github_rate_limit",
  );
}

export function getRateLimitResumeAt(): number | null {
  return pauseUntil > Date.now() ? pauseUntil : null;
}

export function octokitFor(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatWaitLog(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))}s`;
  return `${Math.ceil(ms / 60_000)}m`;
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) continue;
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

function setPause(until: number): void {
  if (until > pauseUntil) pauseUntil = until;
}

function clearPauseIfElapsed(): void {
  if (pauseUntil > 0 && pauseUntil <= Date.now()) pauseUntil = 0;
}

async function waitForPause(): Promise<void> {
  const wait = pauseUntil - Date.now();
  if (wait <= 0) {
    clearPauseIfElapsed();
    return;
  }
  console.log(`[github] waiting ${formatWaitLog(wait)} for rate limit reset`);
  await sleep(wait);
  clearPauseIfElapsed();
}

async function applyRateLimitHeaders(headers: Record<string, unknown> | undefined): Promise<void> {
  const remainingRaw = headerValue(headers, "x-ratelimit-remaining");
  const resetRaw = headerValue(headers, "x-ratelimit-reset");
  const remaining = remainingRaw === undefined ? NaN : Number(remainingRaw);
  const resetSec = resetRaw === undefined ? NaN : Number(resetRaw);
  if (!Number.isFinite(remaining) || remaining >= 100) return;
  if (!Number.isFinite(resetSec)) return;
  const until = resetSec * 1000;
  const wait = until - Date.now();
  if (wait <= 0) return;
  setPause(until);
  console.log(
    `[github] remaining=${remaining}, pausing ${formatWaitLog(wait)} until reset`,
  );
  await sleep(wait);
  clearPauseIfElapsed();
}

function githubStatus(err: unknown): number | undefined {
  if (!isRecord(err)) return undefined;
  if (typeof err.status === "number") return err.status;
  if (isRecord(err.response) && typeof err.response.status === "number") {
    return err.response.status;
  }
  return undefined;
}

function githubErrorHeaders(err: unknown): Record<string, unknown> | undefined {
  if (!isRecord(err) || !isRecord(err.response) || !isRecord(err.response.headers)) {
    return undefined;
  }
  return err.response.headers;
}

function githubErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isRecord(err) && isRecord(err.response) && isRecord(err.response.data)) {
    const msg = err.response.data.message;
    if (typeof msg === "string") return msg;
  }
  return String(err);
}

function isRateLimitedResponse(err: unknown): boolean {
  const status = githubStatus(err);
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = githubErrorHeaders(err);
  if (headerValue(headers, "retry-after")) return true;
  if (headerValue(headers, "x-ratelimit-remaining") === "0") return true;
  const msg = githubErrorMessage(err).toLowerCase();
  return msg.includes("rate limit") || msg.includes("secondary rate");
}

function resumeAtFromError(err: unknown): number {
  const headers = githubErrorHeaders(err);
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Date.now() + secs * 1000;
  }
  const reset = headerValue(headers, "x-ratelimit-reset");
  if (reset) {
    const resetSec = Number(reset);
    if (Number.isFinite(resetSec) && resetSec > 1_000_000_000) return resetSec * 1000;
  }
  return Date.now() + 60_000;
}

async function handleRateLimitError(err: unknown): Promise<void> {
  if (!isRateLimitedResponse(err)) return;
  const until = resumeAtFromError(err);
  const wait = Math.max(0, until - Date.now());
  setPause(until);
  console.log(
    `[github] ${githubStatus(err) ?? "?"} rate limited, pausing ${formatWaitLog(wait)}`,
  );
  await sleep(wait);
  clearPauseIfElapsed();
  throw new GithubRateLimitError(until);
}

async function withGithubLimit<T>(fn: () => Promise<T>): Promise<T> {
  return githubLimit(async () => {
    await waitForPause();
    try {
      return await fn();
    } catch (err: unknown) {
      await handleRateLimitError(err);
      throw err;
    }
  });
}

async function githubResponse<T>(
  run: () => Promise<{ data: T; headers: object; status: number }>,
): Promise<{ data: T; headers: Record<string, unknown>; status: number }> {
  return withGithubLimit(async () => {
    const res = await run();
    const headers = res.headers as Record<string, unknown>;
    await applyRateLimitHeaders(headers);
    return { data: res.data, headers, status: res.status };
  });
}

type GithubRepo = {
  name: string;
  fork: boolean;
  archived: boolean;
  size: number;
  default_branch: string;
  description: string | null;
  pushed_at?: string | null;
  owner: { login: string };
};

function isGithubRepo(value: unknown): value is GithubRepo {
  if (!isRecord(value)) return false;
  const owner = value.owner;
  return (
    typeof value.name === "string" &&
    typeof value.fork === "boolean" &&
    typeof value.archived === "boolean" &&
    typeof value.size === "number" &&
    typeof value.default_branch === "string" &&
    (value.description === null || typeof value.description === "string") &&
    isRecord(owner) &&
    typeof owner.login === "string"
  );
}

function envFlag(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function nextLink(linkHeader: string | undefined): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const section = part.trim();
    if (!section.includes('rel="next"')) continue;
    const match = section.match(/<([^>]+)>/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function logGithubError(err: unknown): void {
  const status = githubStatus(err);
  const body = isRecord(err) && isRecord(err.response) ? err.response.data : err;
  console.error("[sync] GitHub error", status, body);
}

async function paginateGithubRepos(
  client: Octokit,
  path: string,
  params: Record<string, string | number>,
  login: string,
): Promise<{ rawCount: number; repos: GithubRepo[] }> {
  const collected: GithubRepo[] = [];
  let url: string | null = null;
  let page = 0;
  let total = 0;

  for (;;) {
    page += 1;
    let response;
    try {
      const pageUrl = url;
      response = pageUrl
        ? await githubResponse(() => client.request({ method: "GET", url: pageUrl }))
        : await githubResponse(() => client.request(`GET ${path}`, { ...params, per_page: 100 }));
    } catch (err: unknown) {
      logGithubError(err);
      throw err;
    }
    const arr = Array.isArray(response.data) ? response.data : [];
    console.log("[sync] page", page, "returned", arr.length, "repos");
    total += arr.length;
    collected.push(...arr.filter(isGithubRepo));
    const link = headerValue(response.headers, "link");
    const next = nextLink(link);
    if (!next) break;
    url = next;
  }

  console.log("[sync] total", total, "for user", login);
  return { rawCount: total, repos: collected };
}

export async function discoverRepos(
  token: string,
  login: string,
): Promise<{ rawCount: number; repos: DiscoveredRepo[] }> {
  const includeForks = envFlag("INCLUDE_FORKS");
  const includeArchived = envFlag("INCLUDE_ARCHIVED");
  const client = octokitFor(token);

  const listed = await paginateGithubRepos(
    client,
    "/user/repos",
    { affiliation: "owner,collaborator,organization_member" },
    login,
  );

  const repos = listed.repos
    .filter((repo) => {
      if (repo.fork && !includeForks) return false;
      if (repo.archived && !includeArchived) return false;
      if (repo.size === 0) return false;
      return true;
    })
    .map((repo) => ({
      slug: `${repo.owner.login}/${repo.name}`,
      owner: repo.owner.login,
      name: repo.name,
      defaultBranch: repo.default_branch,
      description: repo.description,
      pushedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : null,
      size: repo.size,
    }));

  return { rawCount: listed.rawCount, repos };
}

export async function fetchRepoMeta(
  token: string,
  owner: string,
  name: string,
): Promise<RepoMeta> {
  const { data } = await githubResponse(() =>
    octokitFor(token).repos.get({ owner, repo: name }),
  );
  return {
    owner: data.owner.login,
    name: data.name,
    defaultBranch: data.default_branch,
    description: data.description,
    size: data.size,
  };
}

export async function fetchHeadSha(
  token: string,
  owner: string,
  name: string,
  branch: string,
): Promise<string> {
  const { data } = await githubResponse(() =>
    octokitFor(token).repos.getCommit({
      owner,
      repo: name,
      ref: branch,
    }),
  );
  return data.sha;
}

export async function fetchGithubUser(token: string): Promise<{
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}> {
  const { data } = await githubResponse(() => octokitFor(token).users.getAuthenticated());
  return {
    id: data.id,
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
  };
}

class ByteCap extends Transform {
  private seen = 0;

  constructor(private readonly max: number) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > this.max) {
      cb(new RepoTooLargeError());
      return;
    }
    cb(null, chunk);
  }
}

function asNodeReadable(data: unknown): Readable {
  if (data instanceof Readable) return data;
  if (typeof Readable.fromWeb === "function" && isWebReadable(data)) {
    return Readable.fromWeb(data as Parameters<typeof Readable.fromWeb>[0]);
  }
  if (data instanceof ArrayBuffer) return Readable.from(Buffer.from(data));
  if (ArrayBuffer.isView(data)) {
    return Readable.from(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  throw new Error("Unexpected tarball response body");
}

function isWebReadable(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "getReader" in value);
}

function stripTarballPrefix(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/").replace(/^\.\//, "");
  const slash = normalized.indexOf("/");
  if (slash === -1) return "";
  return normalized.slice(slash + 1);
}

function drain(stream: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.resume();
    stream.once("end", () => resolve());
    stream.once("error", reject);
  });
}

function readCapped(stream: Readable, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let skipped = false;
    stream.on("data", (chunk: Buffer | Uint8Array) => {
      if (skipped) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        skipped = true;
        chunks.length = 0;
        stream.resume();
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => resolve(skipped ? null : Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function extractArchive(body: unknown): Promise<Map<string, ArchivedFile>> {
  const files = new Map<string, ArchivedFile>();
  const cap = new ByteCap(MAX_ARCHIVE_BYTES);
  const extract = tarExtract();
  const limit = maxFileBytes();

  extract.on("entry", (header, stream, next) => {
    void (async () => {
      try {
        if (header.type !== "file") {
          await drain(stream as unknown as Readable);
          next();
          return;
        }
        const path = stripTarballPrefix(header.name);
        if (!path || isBlockedPath(path) || isTooLarge(header.size)) {
          await drain(stream as unknown as Readable);
          next();
          return;
        }
        const buf = await readCapped(stream as unknown as Readable, limit);
        if (!buf || isBinaryBuffer(buf)) {
          next();
          return;
        }
        files.set(path, {
          content: buf.toString("utf8"),
          size: buf.byteLength,
          sha: gitBlobSha(buf),
        });
        next();
      } catch (err: unknown) {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });

  await pipeline(
    asNodeReadable(body),
    cap,
    gunzipMaybe(),
    extract as unknown as NodeJS.WritableStream,
  );
  return files;
}

export async function fetchRepoArchive(
  token: string,
  owner: string,
  name: string,
  ref: string,
): Promise<Map<string, ArchivedFile>> {
  return withGithubLimit(async () => {
    const response = await octokitFor(token).request("GET /repos/{owner}/{repo}/tarball/{ref}", {
      owner,
      repo: name,
      ref,
      request: { parseSuccessResponseBody: false },
    });
    await applyRateLimitHeaders(response.headers as unknown as Record<string, unknown>);
    return extractArchive(response.data);
  });
}
