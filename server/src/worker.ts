import "./lib/env.js";
import cron from "node-cron";
import { pathToFileURL } from "node:url";
import type { UserTokenRow } from "shared";
import { decryptToken } from "./lib/crypto.js";
import { query } from "./lib/db.js";
import { refreshUserRepos } from "./lib/indexer.js";
import { enqueueChangedRepos, enqueueUnindexedRepos } from "./lib/queue.js";
import { ensureAuthTables } from "./lib/schema.js";

async function runTick(): Promise<void> {
  const users = await query<UserTokenRow>(`SELECT id, login, access_token_enc FROM users`);
  if (users.length === 0) {
    console.warn("[index] no users yet — sign in with GitHub");
    return;
  }

  for (const user of users) {
    let token: string;
    try {
      token = decryptToken(user.access_token_enc);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[index] cannot decrypt token for ${user.login}: ${message}`);
      continue;
    }

    try {
      const discovered = await refreshUserRepos(user.id, token, user.login);
      console.log(
        `[index] ${user.login}: ${discovered.length} repositor${discovered.length === 1 ? "y" : "ies"}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[index] discovery failed for ${user.login}: ${message}`);
    }
  }

  const unindexed = await enqueueUnindexedRepos();
  const changed = await enqueueChangedRepos();
  console.log(`[index] enqueued unindexed=${unindexed} changed=${changed}`);
}

function cronExpression(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.max(1, Math.round(minutes / 60));
    return `0 */${hours} * * *`;
  }
  return `*/${Math.max(1, minutes)} * * * *`;
}

export async function startWorker(): Promise<void> {
  await runTick();

  const minutes = Number(process.env.INDEX_INTERVAL_MINUTES ?? 10);
  const expr = cronExpression(Number.isFinite(minutes) ? minutes : 10);
  cron.schedule(expr, () => {
    runTick().catch((err: unknown) => {
      console.error("[worker] tick failed", err);
    });
  });
  console.log(`[worker] polling every ${minutes} minute(s) (${expr})`);
}

const entry = process.argv[1];
const isDirectRun =
  typeof entry === "string" && import.meta.url === pathToFileURL(entry).href;

if (isDirectRun) {
  ensureAuthTables()
    .then(() => startWorker())
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
