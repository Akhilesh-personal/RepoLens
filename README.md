# Repo Lens

KVS Technologies · Internal use only

Repo Lens is an internal GitHub explanation tool. Each person signs in with GitHub. Repo Lens then indexes the repositories that user can access, writes a short AI summary of each file, and presents the project as an interactive 3D constellation. Users never see source code — only structure, summaries, and relationships.

## Setup

1. Node 20+ and npm.
2. MySQL 8 reachable with `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (InnoDB / utf8mb4). Existing tables are not created from this repo. New OAuth tables (`users`, `sessions`, `user_repos`) are created automatically on server/worker start. Repos need a `visible` boolean column, default true (`TINYINT(1) NOT NULL DEFAULT 1`).
3. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps).
   - Homepage URL: `WEB_ORIGIN` (dev: `http://localhost:5173`)
   - Authorization callback URL: `{WEB_ORIGIN}/api/auth/callback` (dev: `http://localhost:5173/api/auth/callback` so the session cookie is set on the Vite origin)
4. Copy environment variables:

```bash
cp .env.example .env
```

Fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a 32-byte `TOKEN_ENC_KEY` (64 hex characters). GitHub access tokens are encrypted at rest and never sent to the browser.

5. Install:

```bash
npm install
```

## Run

```bash
npm run dev
```

In a second terminal:

```bash
npm run worker
```

- `npm run dev` — Express API (`localhost:4000`) and Vite frontend (`localhost:5173`, `/api` proxied)
- `npm run worker` — indexing poller

Open [http://localhost:5173](http://localhost:5173) and continue with GitHub.

Production:

```bash
npm run build
NODE_ENV=production npm start
```

Serves the API and the built frontend from the Express server (`PORT`, default 4000). Set `WEB_ORIGIN` to that public origin and the same callback URL on the GitHub OAuth App.

## Environment

| Key | Purpose |
| --- | --- |
| `PORT` | API server port (default 4000) |
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port (default 3306) |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | MySQL database name |
| `WEB_ORIGIN` | Frontend origin. CORS and the post-login redirect. OAuth `redirect_uri` is `{WEB_ORIGIN}/api/auth/callback`. |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client id |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `TOKEN_ENC_KEY` | 32-byte AES-256-GCM key as 64 hex characters (or 32-byte base64). Encrypts GitHub access tokens at rest. |
| `INCLUDE_FORKS` | `true` to index forks. Default false. |
| `INCLUDE_ARCHIVED` | `true` to index archived repos. Default false. |
| `GEMINI_API_KEY` | Gemini API key for summarization |
| `GEMINI_MODEL` | Per-file summaries (thinking disabled). Defaults to `gemini-2.5-flash`. Stored on `summaries.model`. Changing this does not invalidate the blob-SHA cache. |
| `GEMINI_MODEL_OVERVIEW` | Folder glosses and repo overview (thinking left on for overview). Defaults to `gemini-2.5-pro`. |
| `INDEX_INTERVAL_MINUTES` | Poll interval (default 10) |
| `MAX_FILE_BYTES` | Skip larger files |
| `CONCURRENCY` | Parallel summarization (default 5) |

## How indexing works

Sign-in uses GitHub OAuth (`repo` and `read:org`). The access token is encrypted with `TOKEN_ENC_KEY` and stored on the `users` row. A `rl_session` httpOnly cookie identifies the browser. APIs return only repositories linked to that user through `user_repos`. Missing access is 404, never 403.

On login, and on each worker tick for each known user, Repo Lens decrypts that user's token and lists `GET /user/repos?affiliation=owner,collaborator,organization_member` (Link-header pagination). It upserts `repos`, upserts `user_repos` for that user, and deletes `user_repos` rows for repos that dropped out of that user's list. Other users' links are left alone.

Empty repos (`size === 0`) are skipped. Forks and archived repos are skipped unless `INCLUDE_FORKS` / `INCLUDE_ARCHIVED` are true.

Summaries stay keyed by blob SHA and are global — two users with access to the same repo share the cache, so Gemini is only paid once. Visibility is per-user; content is not.

For each discovered repo the worker:

1. Reads the default-branch HEAD. If that SHA matches `repos.last_indexed_sha`, the run is skipped.
2. Walks the git tree. Blocked paths (secrets, vendor dirs, lockfiles, binaries, oversized files) are recorded as skipped and never sent to the model.
3. Looks up each blob SHA in `summaries`. A cache hit is free forever, across repos and branches — it does not include the model id, so changing `GEMINI_MODEL` does not regenerate existing summaries. Delete from `summaries` if you want a model change to take effect. A miss calls Gemini (structured JSON, `thinkingBudget: 0`), verifies the output does not quote source, then discards the file body.
4. Rebuilds import edges with regex (never the model), refreshes folder glosses, and writes a repo overview.

File text never enters the database or any API response. The constellation, tree, and detail panel are built only from summaries, tags, and metadata.

Manual reindex: `POST /api/index/{owner}/{name}` (authenticated; 404 if the repo is not linked to you).
