import "./lib/env.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webOrigin } from "./lib/env.js";
import { requireAuth } from "./lib/requireAuth.js";
import { enqueueUnindexedRepos } from "./lib/queue.js";
import { ensureAuthTables } from "./lib/schema.js";
import { startWorker } from "./worker.js";
import authRouter from "./routes/auth.js";
import filesRouter from "./routes/files.js";
import indexTriggerRouter from "./routes/index-trigger.js";
import reposRouter from "./routes/repos.js";
import searchRouter from "./routes/search.js";
import syncRouter from "./routes/sync.js";

const app = express();
app.set("trust proxy", 1);
app.use(
  cors({
    origin: webOrigin(),
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api", requireAuth);
app.use("/api/repos", reposRouter);
app.use("/api/files", filesRouter);
app.use("/api/search", searchRouter);
app.use("/api/sync", syncRouter);
app.use("/api/index", indexTriggerRouter);

if (process.env.NODE_ENV === "production") {
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }
}

const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
if (githubClientId) {
  console.log("[auth] GITHUB_CLIENT_ID", githubClientId);
} else {
  console.error("[auth] GITHUB_CLIENT_ID is undefined");
}

const port = Number(process.env.PORT ?? 4000);

try {
  await ensureAuthTables();
} catch (err: unknown) {
  console.error("[server] failed to start", err);
  process.exit(1);
}

function listen(retriesLeft: number): void {
  const server = app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
    void (async () => {
      try {
        const queued = await enqueueUnindexedRepos();
        if (queued > 0) console.log("[server] queued", queued, "unindexed repositories");
        if (process.env.RUN_WORKER === "true") {
          await startWorker();
        }
      } catch (err: unknown) {
        console.error("[server] background start failed", err);
      }
    })();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && retriesLeft > 0) {
      setTimeout(() => listen(retriesLeft - 1), 500);
      return;
    }
    console.error("[server] failed to listen", err);
    process.exit(1);
  });
}

listen(10);
