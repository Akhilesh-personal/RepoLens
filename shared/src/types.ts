import { z } from "zod";

export const TAG_COLORS = {
  ai: "#A78BFA",
  api: "#22D3EE",
  ui: "#F472B6",
  data: "#34D399",
  config: "#FBBF24",
  util: "#94A3B8",
  test: "#64748B",
} as const;

export type TagKey = keyof typeof TAG_COLORS;

export const LEGEND_TAGS: TagKey[] = [
  "ai",
  "api",
  "ui",
  "data",
  "config",
  "util",
  "test",
];

export const ALLOWED_TAGS = [
  "ai",
  "api",
  "ui",
  "data",
  "config",
  "auth",
  "test",
  "build",
  "docs",
  "util",
  "model",
  "worker",
] as const;

export type Tag = (typeof ALLOWED_TAGS)[number];

const TAG_ALIASES: Record<string, TagKey> = {
  model: "ai",
  worker: "ai",
  auth: "api",
  build: "config",
  docs: "util",
};

function isTag(value: string): value is Tag {
  return (ALLOWED_TAGS as readonly string[]).includes(value);
}

function isTagKey(value: string): value is TagKey {
  return value in TAG_COLORS;
}

export function sanitizeTags(tags: string[]): Tag[] {
  const seen = new Set<Tag>();
  const out: Tag[] = [];
  for (const tag of tags) {
    const lower = tag.toLowerCase().trim();
    if (!isTag(lower) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function asTags(value: unknown): Tag[] {
  return sanitizeTags(asStringArray(value));
}

export const FileSummarySchema = z.object({
  role: z.string().min(1),
  summary: z.string().min(1),
  key_exports: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]).transform(sanitizeTags),
});

export type FileSummary = z.infer<typeof FileSummarySchema>;

export const OverviewSchema = z.object({
  what_it_is: z.string(),
  stack: z.array(z.string()),
  entry_points: z.array(z.string()),
  how_it_works: z.string(),
  start_here: z.array(z.string()),
});

export type RepoOverview = z.infer<typeof OverviewSchema>;

export function asOverview(value: unknown): RepoOverview | null {
  const parsed = OverviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function canonicalTag(tag: string): TagKey {
  const lower = tag.toLowerCase();
  if (isTagKey(lower)) return lower;
  return TAG_ALIASES[lower] ?? "util";
}

export function primaryTag(tags: string[] | null | undefined): TagKey {
  if (!tags) return "util";
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (isTagKey(lower)) return lower;
    const aliased = TAG_ALIASES[lower];
    if (aliased) return aliased;
  }
  return "util";
}

export function tagColor(tag: string): string {
  return TAG_COLORS[canonicalTag(tag)];
}

export interface Repo {
  id: number;
  slug: string;
  owner: string;
  name: string;
  default_branch: string;
  description: string | null;
  last_indexed_sha: string | null;
  last_indexed_at: string | null;
  overview: RepoOverview | null;
  visible: number;
}

export interface Folder {
  id: number;
  repo_id: number;
  path: string;
  gloss: string | null;
  updated_at: string;
}

export interface FileRow {
  id: number;
  repo_id: number;
  path: string;
  blob_sha: string;
  language: string | null;
  size_bytes: number;
  skipped: number;
  skip_reason: string | null;
  updated_at: string;
}

export interface Summary {
  blob_sha: string;
  language: string | null;
  role: string;
  summary: string;
  key_exports: string[];
  tags: Tag[];
  model: string;
}

export interface Edge {
  id: number;
  repo_id: number;
  from_path: string;
  to_path: string;
}

export interface IndexRun {
  id: number;
  repo_id: number;
  commit_sha: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  files_seen: number | null;
  files_summarized: number | null;
  cache_hits: number | null;
  error: string | null;
}

export interface RepoIdRow {
  id: number;
}

export interface RepoIndexRow {
  id: number;
  slug: string;
  owner: string;
  name: string;
  default_branch: string;
  description: string | null;
  last_indexed_sha: string | null;
  github_size: number;
}

export interface PathRow {
  path: string;
}

export interface BlobShaRow {
  blob_sha: string;
}

export interface FilePathShaRow {
  path: string;
  blob_sha: string;
}

export interface PathRoleRow {
  path: string;
  role: string;
}

export interface PathGlossRow {
  path: string;
  gloss: string | null;
}

export interface RepoLanguageRow {
  repo_id: number;
  language: string;
}

export interface RepoTagsRow {
  repo_id: number;
  tags: unknown;
}

export interface RepoListQueryRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  overview: unknown;
  last_indexed_sha: string | null;
  last_indexed_at: string | null;
  pushed_at: string | null;
  github_size: number | string;
  file_count: number | string;
  summary_count: number | string;
  indexing: number | boolean;
}

export interface GraphNodeRow {
  id: number;
  path: string;
  size_bytes: number;
  role: string;
  tags: unknown;
}

export interface TreeFileRow {
  id: number;
  path: string;
  role: string | null;
  tags: unknown;
}

export interface FileDetailRow {
  id: number;
  repo_id: number;
  path: string;
  language: string | null;
  size_bytes: number;
  updated_at: string;
  role: string;
  summary: string;
  key_exports: unknown;
  tags: unknown;
}

export interface NeighbourRow {
  id: number;
  path: string;
  role: string;
  tags: unknown;
}

export interface EdgeFromRow {
  from_path: string;
}

export interface EdgeToRow {
  to_path: string;
}

export interface EdgePathRow {
  from_path: string;
  to_path: string;
}

export interface SearchFileRow {
  id: number;
  path: string;
  slug: string;
  role: string;
  summary: string;
  tags: unknown;
}

export interface SearchFolderRow {
  id: number;
  path: string;
  slug: string;
  gloss: string | null;
}

export interface SearchRepoRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  overview: unknown;
}

export type AuthMe = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type RepoSyncResult = {
  discovered: number;
  linked: number;
};

export type AuthUser = AuthMe & {
  id: number;
};

export interface UserTokenRow {
  id: number;
  login: string;
  access_token_enc: string;
}

export interface SessionUserRow {
  session_id: string;
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export type IndexStatus = "queued" | "indexing" | "waiting" | "indexed" | "failed";

export type RepoIndexProgress = {
  done: number;
  total: number;
};

export type IndexQueueState = {
  done: number;
  total: number;
};

export type RepoListItem = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  overview: RepoOverview | null;
  fileCount: number;
  summaryCount: number;
  languages: string[];
  lastIndexedAt: string | null;
  pushedAt: string | null;
  indexing: boolean;
  indexStatus: IndexStatus;
  progress: RepoIndexProgress | null;
  indexError: string | null;
  rateLimitResumeAt: string | null;
  tagSpectrum: { tag: TagKey; count: number }[];
};

export type RepoListResponse = {
  repos: RepoListItem[];
  queue: IndexQueueState;
};

export type GraphNode = {
  id: string;
  path: string;
  name: string;
  role: string;
  tags: Tag[];
  size: number;
  folder: string;
  depth: number;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type TreeNode = {
  type: "folder" | "file";
  name: string;
  path: string;
  gloss?: string | null;
  role?: string;
  tags?: Tag[];
  id?: string;
  children?: TreeNode[];
};

export type TreeResponse = {
  tree: TreeNode[];
};

export type Neighbour = {
  id: string;
  path: string;
  name: string;
  role: string;
  tags: Tag[];
};

export type FileDetail = {
  path: string;
  language: string | null;
  role: string;
  summary: string;
  key_exports: string[];
  tags: Tag[];
  importsPaths: string[];
  importedByPaths: string[];
  sizeBytes: number;
  imports: Neighbour[];
  importedBy: Neighbour[];
  updatedAt: string | null;
};

export type SearchHit = {
  kind: "file" | "folder" | "repo";
  id: string;
  slug: string;
  path: string;
  role: string | null;
  tags: Tag[];
  snippet: string;
};

export type SearchResponse = {
  results: SearchHit[];
};

export type ErrorResponse = {
  error: string;
};

export type IndexSkipResponse = {
  skipped: true;
  sha: string;
  run: IndexRun | null;
};

export type IndexResult =
  | { skipped: true; slug: string; sha: string }
  | { skipped: false; run: IndexRun; slug: string };

export type DiscoveredRepo = {
  slug: string;
  owner: string;
  name: string;
  defaultBranch: string;
  description: string | null;
  pushedAt: string | null;
  size: number;
};

export type RepoMeta = {
  owner: string;
  name: string;
  defaultBranch: string;
  description: string | null;
  size: number;
};

export type GitTreeBlob = {
  path: string;
  sha: string;
  size: number;
};

export type ImportEdge = {
  fromPath: string;
  toPath: string;
};

export type LayoutNode = {
  id: string;
  folder: string;
};

export type LayoutEdge = {
  source: string;
  target: string;
};

export type Vec3 = { x: number; y: number; z: number };

export type SqlParam = string | number | boolean | Date | Buffer | null;
export type SqlParams = SqlParam[];

export function repoSlug(owner: string, name: string): string {
  return `${owner}/${name}`;
}

export function encodeSlug(slug: string): string {
  return encodeURIComponent(slug);
}

export function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function parentFolder(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function folderDepth(path: string): number {
  if (!path) return 0;
  return path.split("/").length;
}

export function languageFromPath(filePath: string): string | null {
  const base = fileName(filePath).toLowerCase();
  if (base === "dockerfile") return "Docker";
  if (base === "makefile") return "Make";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = base.slice(dot + 1);
  if (!ext) return null;
  const map: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    mts: "TypeScript",
    cts: "TypeScript",
    py: "Python",
    go: "Go",
    rs: "Rust",
    java: "Java",
    kt: "Kotlin",
    kts: "Kotlin",
    cs: "C#",
    rb: "Ruby",
    php: "PHP",
    swift: "Swift",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    json: "JSON",
    md: "Markdown",
    mdx: "Markdown",
    yml: "YAML",
    yaml: "YAML",
    toml: "TOML",
    sql: "SQL",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
    graphql: "GraphQL",
    gql: "GraphQL",
    vue: "Vue",
    svelte: "Svelte",
  };
  return map[ext] ?? ext.toUpperCase();
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const delta = Date.now() - then;
  const minutes = Math.round(delta / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
