import { Router, type Request, type Response } from "express";
import { currentUser } from "../lib/access.js";
import { query } from "../lib/db.js";
import {
  asOverview,
  asTags,
  type SearchFileRow,
  type SearchFolderRow,
  type SearchHit,
  type SearchRepoRow,
  type SqlParams,
} from "shared";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 1) {
      res.json({ results: [] });
      return;
    }

    const userId = currentUser(req).id;
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() || null : null;
    const results: SearchHit[] = [];

    const tagClause = tag ? " AND JSON_CONTAINS(s.tags, JSON_QUOTE(?))" : "";
    const fileParams: SqlParams = tag ? [userId, q, q, tag] : [userId, q, q];

    const files = await query<SearchFileRow>(
      `SELECT f.id, f.path, r.slug, s.role, s.summary, s.tags
       FROM summaries s
       JOIN files f ON f.blob_sha = s.blob_sha
       JOIN repos r ON r.id = f.repo_id
       INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
       WHERE f.skipped = 0
         AND (
           MATCH(s.role, s.summary) AGAINST (? IN NATURAL LANGUAGE MODE)
           OR f.path LIKE CONCAT('%', ?, '%')
         )${tagClause}
       LIMIT 20`,
      fileParams,
    );

    for (const row of files) {
      results.push({
        kind: "file",
        id: String(row.id),
        slug: row.slug,
        path: row.path,
        role: row.role,
        tags: asTags(row.tags),
        snippet: row.summary,
      });
    }

    const folders = await query<SearchFolderRow>(
      `SELECT fo.id, fo.path, r.slug, fo.gloss
       FROM folders fo
       JOIN repos r ON r.id = fo.repo_id
       INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
       WHERE (
           fo.path LIKE CONCAT('%', ?, '%')
           OR COALESCE(fo.gloss, '') LIKE CONCAT('%', ?, '%')
         )
       LIMIT 10`,
      [userId, q, q],
    );

    for (const row of folders) {
      results.push({
        kind: "folder",
        id: `folder:${row.id}`,
        slug: row.slug,
        path: row.path,
        role: null,
        tags: [],
        snippet: row.gloss ?? "",
      });
    }

    const repos = await query<SearchRepoRow>(
      `SELECT r.id, r.slug, r.name, r.description, r.overview
       FROM repos r
       INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
       WHERE (
           r.name LIKE CONCAT('%', ?, '%')
           OR r.slug LIKE CONCAT('%', ?, '%')
           OR COALESCE(r.description, '') LIKE CONCAT('%', ?, '%')
         )
       LIMIT 5`,
      [userId, q, q, q],
    );

    for (const row of repos) {
      const overview = asOverview(row.overview);
      results.push({
        kind: "repo",
        id: String(row.id),
        slug: row.slug,
        path: row.slug,
        role: null,
        tags: [],
        snippet: overview?.what_it_is ?? row.description ?? "",
      });
    }

    res.json({ results: results.slice(0, 20) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
