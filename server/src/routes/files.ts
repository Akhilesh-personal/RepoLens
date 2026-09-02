import { Router, type Request, type Response } from "express";
import { currentUser } from "../lib/access.js";
import { placeholders, query, queryOne } from "../lib/db.js";
import {
  asStringArray,
  asTags,
  fileName,
  type EdgeFromRow,
  type EdgeToRow,
  type FileDetail,
  type FileDetailRow,
  type Neighbour,
  type NeighbourRow,
} from "shared";

const router = Router();

async function neighbours(repoId: number, paths: string[]): Promise<Neighbour[]> {
  if (paths.length === 0) return [];
  const rows = await query<NeighbourRow>(
    `SELECT f.id, f.path, s.role, s.tags
     FROM files f
     JOIN summaries s ON s.blob_sha = f.blob_sha
     WHERE f.repo_id = ? AND f.path IN (${placeholders(paths.length)})`,
    [repoId, ...paths],
  );
  const byPath = new Map(rows.map((row) => [row.path, row]));
  return paths.flatMap((path) => {
    const row = byPath.get(path);
    if (!row) return [];
    return [
      {
        id: String(row.id),
        path: row.path,
        name: fileName(row.path),
        role: row.role,
        tags: asTags(row.tags),
      },
    ];
  });
}

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const fileId = Number(req.params.id);
    if (!Number.isFinite(fileId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const row = await queryOne<FileDetailRow>(
      `SELECT f.id, f.repo_id, f.path, f.language, f.size_bytes, f.updated_at,
              s.role, s.summary, s.key_exports, s.tags
       FROM files f
       JOIN summaries s ON s.blob_sha = f.blob_sha
       JOIN repos r ON r.id = f.repo_id
       INNER JOIN user_repos ur ON ur.repo_id = r.id AND ur.user_id = ?
       WHERE f.id = ?`,
      [currentUser(req).id, fileId],
    );
    if (!row) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const imports = await query<EdgeToRow>(
      `SELECT to_path FROM edges WHERE repo_id = ? AND from_path = ?`,
      [row.repo_id, row.path],
    );
    const importedBy = await query<EdgeFromRow>(
      `SELECT from_path FROM edges WHERE repo_id = ? AND to_path = ?`,
      [row.repo_id, row.path],
    );

    const importsPaths = imports.map((e) => e.to_path);
    const importedByPaths = importedBy.map((e) => e.from_path);

    const payload: FileDetail = {
      path: row.path,
      language: row.language,
      role: row.role,
      summary: row.summary,
      key_exports: asStringArray(row.key_exports),
      tags: asTags(row.tags),
      importsPaths,
      importedByPaths,
      sizeBytes: row.size_bytes,
      imports: await neighbours(row.repo_id, importsPaths),
      importedBy: await neighbours(row.repo_id, importedByPaths),
      updatedAt: row.updated_at,
    };

    res.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
