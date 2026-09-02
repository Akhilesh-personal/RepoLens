import pLimit from "p-limit";
import { execMany, execute, insert, placeholders, query, queryOne } from "./db.js";
import {
  discoverRepos,
  fetchHeadSha,
  fetchRepoArchive,
  fetchRepoMeta,
} from "./github.js";
import { buildImportEdges } from "./imports.js";
import {
  createSummarizeLimit,
  generateFolderGloss,
  generateRepoOverview,
  modelName,
  summarizeFile,
} from "./summarize.js";
import {
  languageFromPath,
  parentFolder,
  type BlobShaRow,
  type DiscoveredRepo,
  type FilePathShaRow,
  type IndexResult,
  type IndexRun,
  type PathGlossRow,
  type PathRoleRow,
  type PathRow,
  type RepoIndexRow,
  type RepoOverview,
  type SqlParams,
} from "shared";

const BATCH = 80;

function allFolderPaths(filePaths: string[]): string[] {
  const folders = new Set<string>();
  for (const filePath of filePaths) {
    let current = parentFolder(filePath);
    while (current) {
      folders.add(current);
      current = parentFolder(current);
    }
  }
  return [...folders];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function upsertRepo(slug: string, token: string): Promise<RepoIndexRow> {
  const [owner, name] = slug.split("/");
  if (!owner || !name) throw new Error(`Invalid repo slug: ${slug}`);
  const meta = await fetchRepoMeta(token, owner, name);
  await execute(
    `INSERT INTO repos (slug, owner, name, default_branch, description, visible, github_size)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       owner = VALUES(owner),
       name = VALUES(name),
       default_branch = VALUES(default_branch),
       description = VALUES(description),
       github_size = VALUES(github_size),
       visible = 1`,
    [slug, meta.owner, meta.name, meta.defaultBranch, meta.description, meta.size],
  );
  const row = await queryOne<RepoIndexRow>(
    `SELECT id, slug, owner, name, default_branch, description, last_indexed_sha, github_size
     FROM repos WHERE slug = ?`,
    [slug],
  );
  if (!row) throw new Error("Failed to upsert repo");
  return row;
}

export async function syncUserRepos(
  userId: number,
  discovered: DiscoveredRepo[],
): Promise<void> {
  const repoIds: number[] = [];

  for (const repo of discovered) {
    await execute(
      `INSERT INTO repos (slug, owner, name, default_branch, description, visible, pushed_at, github_size)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         owner = VALUES(owner),
         name = VALUES(name),
         default_branch = VALUES(default_branch),
         description = VALUES(description),
         pushed_at = VALUES(pushed_at),
         github_size = VALUES(github_size)`,
      [repo.slug, repo.owner, repo.name, repo.defaultBranch, repo.description, repo.pushedAt, repo.size],
    );
    const row = await queryOne<{ id: number }>(`SELECT id FROM repos WHERE slug = ?`, [repo.slug]);
    if (!row) continue;
    repoIds.push(row.id);
    await execute(
      `INSERT INTO user_repos (user_id, repo_id, seen_at) VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE seen_at = NOW(3)`,
      [userId, row.id],
    );
  }

  if (repoIds.length === 0) {
    await execute(`DELETE FROM user_repos WHERE user_id = ?`, [userId]);
    return;
  }

  await execute(
    `DELETE FROM user_repos WHERE user_id = ? AND repo_id NOT IN (${placeholders(repoIds.length)})`,
    [userId, ...repoIds],
  );
}

export async function refreshUserRepos(
  userId: number,
  token: string,
  login: string,
): Promise<DiscoveredRepo[]> {
  const { repos } = await discoverRepos(token, login);
  await syncUserRepos(userId, repos);
  return repos;
}

async function closeRun(
  runId: number,
  status: "success" | "failed",
  stats: {
    files_seen?: number;
    files_summarized?: number;
    cache_hits?: number;
    error?: string | null;
  },
): Promise<IndexRun | null> {
  await execute(
    `UPDATE index_runs SET
       finished_at = NOW(),
       status = ?,
       files_seen = COALESCE(?, files_seen),
       files_summarized = COALESCE(?, files_summarized),
       cache_hits = COALESCE(?, cache_hits),
       error = ?
     WHERE id = ?`,
    [
      status,
      stats.files_seen ?? null,
      stats.files_summarized ?? null,
      stats.cache_hits ?? null,
      stats.error ?? null,
      runId,
    ],
  );
  return queryOne<IndexRun>(`SELECT * FROM index_runs WHERE id = ?`, [runId]);
}

async function cachedShas(shas: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const group of chunk(shas, 400)) {
    if (group.length === 0) continue;
    const rows = await query<BlobShaRow>(
      `SELECT blob_sha FROM summaries WHERE blob_sha IN (${placeholders(group.length)})`,
      group,
    );
    for (const row of rows) found.add(row.blob_sha);
  }
  return found;
}

async function upsertFiles(
  repoId: number,
  rows: {
    path: string;
    blob_sha: string;
    language: string | null;
    size_bytes: number;
    skipped: boolean;
    skip_reason: string | null;
  }[],
): Promise<void> {
  if (rows.length === 0) {
    await execute(`DELETE FROM files WHERE repo_id = ?`, [repoId]);
    return;
  }

  for (const group of chunk(rows, BATCH)) {
    const valueSql = group.map(() => "(?, ?, ?, ?, ?, ?, ?, NOW())").join(", ");
    const params: SqlParams = [];
    for (const row of group) {
      params.push(
        repoId,
        row.path,
        row.blob_sha,
        row.language,
        row.size_bytes,
        row.skipped ? 1 : 0,
        row.skip_reason,
      );
    }
    await execMany(
      `INSERT INTO files (repo_id, path, blob_sha, language, size_bytes, skipped, skip_reason, updated_at)
       VALUES ${valueSql}
       ON DUPLICATE KEY UPDATE
         blob_sha = VALUES(blob_sha),
         language = VALUES(language),
         size_bytes = VALUES(size_bytes),
         skipped = VALUES(skipped),
         skip_reason = VALUES(skip_reason),
         updated_at = NOW()`,
      params,
    );
  }

  const paths = rows.map((row) => row.path);
  const keep = new Set(paths);
  const existing = await query<PathRow>(`SELECT path FROM files WHERE repo_id = ?`, [
    repoId,
  ]);
  const stale = existing.map((row) => row.path).filter((path) => !keep.has(path));
  for (const group of chunk(stale, 400)) {
    await execute(
      `DELETE FROM files WHERE repo_id = ? AND path IN (${placeholders(group.length)})`,
      [repoId, ...group],
    );
  }
}

async function replaceEdges(
  repoId: number,
  edges: { fromPath: string; toPath: string }[],
): Promise<void> {
  await execute(`DELETE FROM edges WHERE repo_id = ?`, [repoId]);
  if (edges.length === 0) return;
  for (const group of chunk(edges, BATCH)) {
    const valueSql = group.map(() => "(?, ?, ?)").join(", ");
    const params: SqlParams = [];
    for (const edge of group) {
      params.push(repoId, edge.fromPath, edge.toPath);
    }
    await execMany(
      `INSERT INTO edges (repo_id, from_path, to_path)
       VALUES ${valueSql}
       ON DUPLICATE KEY UPDATE id = id`,
      params,
    );
  }
}

function directRolesByFolder(
  files: { path: string; role: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of files) {
    const folder = parentFolder(file.path);
    const list = map.get(folder) ?? [];
    list.push(file.role);
    map.set(folder, list);
  }
  return map;
}

async function refreshFolderGlosses(
  repoId: number,
  force: Set<string> | "all",
): Promise<void> {
  const filesWithRoles = await query<PathRoleRow>(
    `SELECT f.path, s.role
     FROM files f
     JOIN summaries s ON s.blob_sha = f.blob_sha
     WHERE f.repo_id = ? AND f.skipped = 0`,
    [repoId],
  );
  const folders = allFolderPaths(filesWithRoles.map((row) => row.path));
  const existing = await query<PathGlossRow>(`SELECT path, gloss FROM folders WHERE repo_id = ?`, [
    repoId,
  ]);
  const glossByPath = new Map(existing.map((row) => [row.path, row.gloss]));
  const byFolder = directRolesByFolder(filesWithRoles);

  const toUpdate = new Set(
    folders.filter((folder) => {
      if (force === "all") return true;
      if (force.has(folder)) return true;
      return !glossByPath.get(folder);
    }),
  );

  const used = new Set<string>();
  for (const folder of folders) {
    if (toUpdate.has(folder)) continue;
    const gloss = glossByPath.get(folder);
    if (gloss) used.add(gloss.trim().toLowerCase());
  }

  const glossLimit = pLimit(3);
  await Promise.all(
    [...toUpdate].map((folder) =>
      glossLimit(async () => {
        const gloss = await generateFolderGloss(folder, byFolder.get(folder) ?? [], used);
        await execute(
          `INSERT INTO folders (repo_id, path, gloss, updated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE gloss = VALUES(gloss), updated_at = NOW()`,
          [repoId, folder, gloss],
        );
      }),
    ),
  );

  if (folders.length === 0) {
    await execute(`DELETE FROM folders WHERE repo_id = ?`, [repoId]);
    return;
  }

  const keep = new Set(folders);
  const extra = existing.map((row) => row.path).filter((path) => !keep.has(path));
  for (const group of chunk(extra, 400)) {
    await execute(
      `DELETE FROM folders WHERE repo_id = ? AND path IN (${placeholders(group.length)})`,
      [repoId, ...group],
    );
  }
}

export async function indexRepo(
  slug: string,
  token: string,
  onProgress?: (done: number, total: number) => void,
): Promise<IndexResult> {
  const started = Date.now();
  const existing = await queryOne<RepoIndexRow>(
    `SELECT id, slug, owner, name, default_branch, description, last_indexed_sha, github_size
     FROM repos WHERE slug = ?`,
    [slug],
  );
  const repo = existing ?? (await upsertRepo(slug, token));
  const headSha = await fetchHeadSha(token, repo.owner, repo.name, repo.default_branch);

  if (headSha === repo.last_indexed_sha) {
    await refreshFolderGlosses(repo.id, new Set());
    const short = headSha.slice(0, 7);
    console.log(
      `[index] ${repo.owner}/${repo.name}  sha=${short}  files=0  new=0  cached=0  skipped  ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    return { skipped: true, slug, sha: headSha };
  }

  const runId = await insert(
    `INSERT INTO index_runs (repo_id, commit_sha, status)
     VALUES (?, ?, 'running')`,
    [repo.id, headSha],
  );
  const run = await queryOne<IndexRun>(`SELECT * FROM index_runs WHERE id = ?`, [runId]);
  if (!run) throw new Error("Failed to open index run");

  try {
    const archive = await fetchRepoArchive(token, repo.owner, repo.name, headSha);
    const previous = await query<FilePathShaRow>(`SELECT path, blob_sha FROM files WHERE repo_id = ?`, [
      repo.id,
    ]);
    const previousByPath = new Map(previous.map((row) => [row.path, row.blob_sha]));

    const summarizeLimit = createSummarizeLimit();

    const fileRows: {
      path: string;
      blob_sha: string;
      language: string | null;
      size_bytes: number;
      skipped: boolean;
      skip_reason: string | null;
    }[] = [];
    const texts = new Map<string, string>();
    let cacheHits = 0;
    let summarized = 0;
    const changedFolders = new Set<string>();
    let anyFileChanged = previous.length === 0;

    const entries = [...archive.entries()].map(([path, file]) => ({
      path,
      sha: file.sha,
      size: file.size,
      content: file.content,
    }));

    const total = Math.max(entries.length, 1);
    let done = 0;
    const tick = () => {
      done += 1;
      onProgress?.(done, total);
    };
    onProgress?.(0, total);

    const uniqueShas = [...new Set(entries.map((entry) => entry.sha))];
    const hitSet = await cachedShas(uniqueShas);

    await Promise.all(
      entries.map(async (entry) => {
        texts.set(entry.path, entry.content);
        fileRows.push({
          path: entry.path,
          blob_sha: entry.sha,
          language: languageFromPath(entry.path),
          size_bytes: entry.size,
          skipped: false,
          skip_reason: null,
        });

        if (previousByPath.get(entry.path) !== entry.sha) {
          anyFileChanged = true;
          let folder = parentFolder(entry.path);
          while (folder) {
            changedFolders.add(folder);
            folder = parentFolder(folder);
          }
        }

        if (hitSet.has(entry.sha)) {
          cacheHits += 1;
          tick();
          return;
        }

        await summarizeLimit(async () => {
          const summary = await summarizeFile({
            owner: repo.owner,
            name: repo.name,
            path: entry.path,
            language: languageFromPath(entry.path),
            content: entry.content,
          });
          await execute(
            `INSERT INTO summaries (blob_sha, language, role, summary, key_exports, tags, model)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE blob_sha = blob_sha`,
            [
              entry.sha,
              languageFromPath(entry.path),
              summary.role,
              summary.summary,
              JSON.stringify(summary.key_exports),
              JSON.stringify(summary.tags),
              modelName(),
            ],
          );
          summarized += 1;
        });
        tick();
      }),
    );

    const stale = previous.filter((row) => !archive.has(row.path));
    if (stale.length > 0) {
      anyFileChanged = true;
      for (const row of stale) {
        let folder = parentFolder(row.path);
        while (folder) {
          changedFolders.add(folder);
          folder = parentFolder(folder);
        }
      }
    }

    await upsertFiles(repo.id, fileRows);

    const importFiles = [...texts.entries()].map(([path, text]) => ({ path, text }));
    const edges = buildImportEdges(importFiles);
    await replaceEdges(repo.id, edges);

    if (anyFileChanged) {
      await refreshFolderGlosses(
        repo.id,
        previous.length === 0 ? "all" : changedFolders,
      );

      const allGlosses = await query<PathGlossRow>(
        `SELECT path, gloss FROM folders WHERE repo_id = ? AND gloss IS NOT NULL`,
        [repo.id],
      );
      const languages = [
        ...new Set(
          fileRows
            .filter((row): row is typeof row & { language: string } =>
              !row.skipped && Boolean(row.language),
            )
            .map((row) => row.language),
        ),
      ];
      const largest = await query<PathRoleRow>(
        `SELECT f.path, s.role
         FROM files f
         JOIN summaries s ON s.blob_sha = f.blob_sha
         WHERE f.repo_id = ? AND f.skipped = 0
         ORDER BY f.size_bytes DESC
         LIMIT 25`,
        [repo.id],
      );
      const overview: RepoOverview = await generateRepoOverview({
        name: repo.name,
        description: repo.description,
        folderGlosses: allGlosses.flatMap((g) =>
          g.gloss ? [{ path: g.path, gloss: g.gloss }] : [],
        ),
        languages,
        largestRoles: largest,
      });
      await execute(`UPDATE repos SET overview = ? WHERE id = ?`, [
        JSON.stringify(overview),
        repo.id,
      ]);
    }

    await execute(`UPDATE repos SET last_indexed_sha = ?, last_indexed_at = NOW() WHERE id = ?`, [
      headSha,
      repo.id,
    ]);

    const closed = await closeRun(run.id, "success", {
      files_seen: entries.length,
      files_summarized: summarized,
      cache_hits: cacheHits,
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[index] ${repo.owner}/${repo.name}  sha=${headSha.slice(0, 7)}  files=${entries.length}  new=${summarized}  cached=${cacheHits}  ${elapsed}s`,
    );

    return { skipped: false, run: closed ?? run, slug };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await closeRun(run.id, "failed", { error: message });
    console.error(`[index] ${slug} failed: ${message}`);
    throw err;
  }
}

export async function indexRepoById(
  repoId: number,
  token: string,
  onProgress?: (done: number, total: number) => void,
): Promise<IndexResult> {
  const repo = await queryOne<{ slug: string }>(`SELECT slug FROM repos WHERE id = ?`, [repoId]);
  if (!repo) throw new Error(`Repo ${repoId} not found`);
  return indexRepo(repo.slug, token, onProgress);
}
