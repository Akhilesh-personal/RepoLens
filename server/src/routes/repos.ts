import { Router, type Request, type Response } from "express";
import { currentUser, userRepoBySlug } from "../lib/access.js";
import { query } from "../lib/db.js";
import { getError, getProgress, getQueueState, getStatus } from "../lib/queue.js";
import { getRateLimitResumeAt } from "../lib/github.js";
import {
  asOverview,
  asTags,
  canonicalTag,
  fileName,
  folderDepth,
  parentFolder,
  repoSlug,
  type EdgePathRow,
  type GraphNodeRow,
  type GraphResponse,
  type IndexStatus,
  type PathGlossRow,
  type RepoLanguageRow,
  type RepoListItem,
  type RepoListQueryRow,
  type RepoListResponse,
  type RepoTagsRow,
  type SqlParams,
  type TagKey,
  type TreeFileRow,
  type TreeNode,
} from "shared";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = currentUser(req);
    const rows = await query<RepoListQueryRow>(
      `SELECT
         r.id,
         r.slug,
         r.name,
         r.description,
         r.overview,
         r.last_indexed_sha,
         r.last_indexed_at,
         r.pushed_at,
         r.github_size,
         COUNT(f.id) AS file_count,
         COUNT(s.blob_sha) AS summary_count,
         EXISTS (
           SELECT 1 FROM index_runs ir
           WHERE ir.repo_id = r.id AND ir.status = 'running'
         ) AS indexing
       FROM repos r
       INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
       LEFT JOIN files f ON f.repo_id = r.id
       LEFT JOIN summaries s ON s.blob_sha = f.blob_sha
       GROUP BY r.id
       ORDER BY (COUNT(s.blob_sha) > 0) DESC, r.pushed_at IS NULL ASC, r.pushed_at DESC, r.name ASC`,
      [user.id],
    );
    console.log("[api] /repos user", user.login, "->", rows.length, "repos");

    const languageRows = await query<RepoLanguageRow>(
      `SELECT DISTINCT f.repo_id, f.language
       FROM files f
       INNER JOIN user_repos ur ON ur.repo_id = f.repo_id AND ur.user_id = ?
       WHERE f.skipped = 0 AND f.language IS NOT NULL`,
      [user.id],
    );
    const languagesByRepo = new Map<number, string[]>();
    for (const row of languageRows) {
      const list = languagesByRepo.get(row.repo_id) ?? [];
      list.push(row.language);
      languagesByRepo.set(row.repo_id, list);
    }

    const spectra = await query<RepoTagsRow>(
      `SELECT f.repo_id, s.tags
       FROM files f
       JOIN summaries s ON s.blob_sha = f.blob_sha
       INNER JOIN user_repos ur ON ur.repo_id = f.repo_id AND ur.user_id = ?
       WHERE f.skipped = 0`,
      [user.id],
    );

    const byRepo = new Map<number, Map<TagKey, number>>();
    for (const row of spectra) {
      const tags = asTags(row.tags);
      const map = byRepo.get(row.repo_id) ?? new Map<TagKey, number>();
      if (tags.length === 0) {
        map.set("util", (map.get("util") ?? 0) + 1);
      } else {
        const first = tags[0];
        const key = canonicalTag(first ?? "util");
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      byRepo.set(row.repo_id, map);
    }

    const payload: RepoListItem[] = rows.map((row) => {
      const spectrum = [...(byRepo.get(row.id) ?? new Map()).entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
      const indexStatus = statusFor(row);
      const indexing = indexStatus === "indexing";
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        overview: asOverview(row.overview),
        fileCount: Number(row.file_count),
        summaryCount: Number(row.summary_count),
        languages: languagesByRepo.get(row.id) ?? [],
        lastIndexedAt: row.last_indexed_at,
        pushedAt: row.pushed_at,
        indexing,
        indexStatus,
        progress: indexing ? getProgress(row.id) : null,
        indexError: indexStatus === "failed" ? getError(row.id) : null,
        rateLimitResumeAt:
          indexStatus === "waiting"
            ? new Date(getRateLimitResumeAt() ?? Date.now()).toISOString()
            : null,
        tagSpectrum: spectrum,
      };
    });

    const body: RepoListResponse = {
      repos: payload,
      queue: getQueueState(),
    };
    res.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get("/:owner/:name/graph", async (req: Request, res: Response) => {
  try {
    const owner = String(req.params.owner ?? "");
    const name = String(req.params.name ?? "");
    const slug = repoSlug(owner, name);
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() || null : null;
    const repo = await userRepoBySlug(currentUser(req).id, slug);
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const tagClause = tag ? " AND JSON_CONTAINS(s.tags, JSON_QUOTE(?))" : "";
    const params: SqlParams = tag ? [repo.id, tag] : [repo.id];

    const nodes = await query<GraphNodeRow>(
      `SELECT f.id, f.path, f.size_bytes, s.role, s.tags
       FROM files f
       JOIN summaries s ON s.blob_sha = f.blob_sha
       WHERE f.repo_id = ? AND f.skipped = 0${tagClause}`,
      params,
    );

    const pathToId = new Map(nodes.map((node) => [node.path, String(node.id)]));

    const edgeRows = await query<EdgePathRow>(
      `SELECT from_path, to_path FROM edges WHERE repo_id = ?`,
      [repo.id],
    );

    const payload: GraphResponse = {
      nodes: nodes.map((node) => ({
        id: String(node.id),
        path: node.path,
        name: fileName(node.path),
        role: node.role,
        tags: asTags(node.tags),
        size: node.size_bytes,
        folder: parentFolder(node.path),
        depth: folderDepth(node.path),
      })),
      edges: edgeRows.flatMap((edge) => {
        const source = pathToId.get(edge.from_path);
        const target = pathToId.get(edge.to_path);
        if (!source || !target) return [];
        return [{ source, target }];
      }),
    };

    res.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

function insertAt(
  root: TreeNode[],
  parts: string[],
  file: TreeFileRow,
  glosses: Map<string, string | null>,
): void {
  let children = root;
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    acc = acc ? `${acc}/${part}` : part;
    const isLeaf = i === parts.length - 1;
    if (isLeaf) {
      children.push({
        type: "file",
        name: fileName(file.path),
        path: file.path,
        role: file.role ?? "Unknown",
        tags: asTags(file.tags),
        id: String(file.id),
      });
      return;
    }
    let folder = children.find((child) => child.type === "folder" && child.path === acc);
    if (!folder) {
      folder = {
        type: "folder",
        name: part,
        path: acc,
        gloss: glosses.get(acc) ?? null,
        children: [],
      };
      children.push(folder);
    }
    children = folder.children ?? [];
  }
}

router.get("/:owner/:name/tree", async (req: Request, res: Response) => {
  try {
    const owner = String(req.params.owner ?? "");
    const name = String(req.params.name ?? "");
    const slug = repoSlug(owner, name);
    const repo = await userRepoBySlug(currentUser(req).id, slug);
    if (!repo) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const files = await query<TreeFileRow>(
      `SELECT f.id, f.path, s.role, s.tags
       FROM files f
       LEFT JOIN summaries s ON s.blob_sha = f.blob_sha
       WHERE f.repo_id = ? AND f.skipped = 0
       ORDER BY f.path ASC`,
      [repo.id],
    );
    const folders = await query<PathGlossRow>(`SELECT path, gloss FROM folders WHERE repo_id = ?`, [
      repo.id,
    ]);
    const glosses = new Map(folders.map((folder) => [folder.path, folder.gloss]));

    const tree: TreeNode[] = [];
    for (const file of files) {
      insertAt(tree, file.path.split("/"), file, glosses);
    }

    res.json({ tree });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;

function statusFor(row: RepoListQueryRow): IndexStatus {
  const live = getStatus(row.id);
  if (live === "waiting") return "waiting";
  const dbRunning = Boolean(row.indexing);
  if (live === "indexing" || dbRunning) return "indexing";
  if (live === "queued") return "queued";
  if (live === "failed") return "failed";
  if (row.last_indexed_sha) return "indexed";
  return "queued";
}
