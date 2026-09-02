import { Router, type Request, type Response } from "express";
import type { RepoSyncResult } from "shared";
import { accessTokenForUser, currentUser } from "../lib/access.js";
import { discoverRepos } from "../lib/github.js";
import { syncUserRepos } from "../lib/indexer.js";
import { enqueueUnindexedForUser } from "../lib/queue.js";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const user = currentUser(req);
  try {
    const token = await accessTokenForUser(user.id);
    const { rawCount, repos } = await discoverRepos(token, user.login);
    await syncUserRepos(user.id, repos);
    const queued = await enqueueUnindexedForUser(user.id);
    console.log("[sync] queued", queued, "unindexed repos for", user.login);
    const payload: RepoSyncResult = {
      discovered: rawCount,
      linked: repos.length,
    };
    res.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] failed for ${user.login}: ${message}`);
    res.status(500).json({ error: message });
  }
});

export default router;
