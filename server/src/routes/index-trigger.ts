import { Router, type Request, type Response } from "express";
import { currentUser, userRepoBySlug } from "../lib/access.js";
import { queryOne } from "../lib/db.js";
import { enqueue } from "../lib/queue.js";
import { repoSlug } from "shared";

const router = Router();

router.post("/:owner/:name", async (req: Request, res: Response) => {
  const owner = String(req.params.owner ?? "");
  const name = String(req.params.name ?? "");
  const slug = repoSlug(owner, name);
  const user = currentUser(req);

  try {
    const linked = await userRepoBySlug(user.id, slug);
    if (!linked) {
      res.status(404).json({ error: "Repo not found" });
      return;
    }

    const sizeRow = await queryOne<{ github_size: number | string }>(
      `SELECT github_size FROM repos WHERE id = ?`,
      [linked.id],
    );
    enqueue(linked.id, Number(sizeRow?.github_size ?? 0));
    res.status(202).json({ started: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
