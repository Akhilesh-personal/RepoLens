import crypto from "node:crypto";
import { Router, type CookieOptions, type Request, type Response } from "express";
import type { AuthMe } from "shared";
import { encryptToken } from "../lib/crypto.js";
import { execute, queryOne } from "../lib/db.js";
import { requiredEnv, webOrigin } from "../lib/env.js";
import { fetchGithubUser } from "../lib/github.js";
import { loadSessionUser } from "../lib/requireAuth.js";

const router = Router();
const SESSION_COOKIE = "rl_session";
const SESSION_DAYS = 30;
const STATE_TTL_MS = 10 * 60 * 1000;

function cookieBase(): CookieOptions {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: production ? "none" : "lax",
    secure: production,
    path: "/",
  };
}

function signOAuthState(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = Date.now().toString(36);
  const payload = `${nonce}.${ts}`;
  const sig = crypto
    .createHmac("sha256", requiredEnv("TOKEN_ENC_KEY"))
    .update(payload)
    .digest("hex")
    .slice(0, 32);
  return `${payload}.${sig}`;
}

function isValidOAuthState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const nonce = parts[0];
  const ts = parts[1];
  const sig = parts[2];
  if (!nonce || !ts || !sig || sig.length !== 32) return false;
  const payload = `${nonce}.${ts}`;
  const expected = crypto
    .createHmac("sha256", requiredEnv("TOKEN_ENC_KEY"))
    .update(payload)
    .digest("hex")
    .slice(0, 32);
  if (!crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) {
    return false;
  }
  const created = Number.parseInt(ts, 36);
  if (!Number.isFinite(created) || Date.now() - created > STATE_TTL_MS) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function exchangeCode(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: requiredEnv("GITHUB_CLIENT_ID"),
      client_secret: requiredEnv("GITHUB_CLIENT_SECRET"),
      code,
    }),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    const description =
      isRecord(payload) && typeof payload.error_description === "string"
        ? payload.error_description
        : "GitHub token exchange failed";
    throw new Error(description);
  }
  return payload.access_token;
}

router.get("/login", (_req: Request, res: Response) => {
  try {
    const state = signOAuthState();
    const params = new URLSearchParams({
      client_id: requiredEnv("GITHUB_CLIENT_ID"),
      scope: "repo read:org",
      state,
    });
    const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
    console.log("[auth] redirecting to", url);
    res.redirect(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth] login failed:", message);
    res.status(500).send("GitHub OAuth is not configured");
  }
});

router.get("/callback", async (req: Request, res: Response) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";

    if (!isValidOAuthState(state)) {
      res.status(400).send("Invalid OAuth state");
      return;
    }
    if (!code) {
      res.status(400).send("Missing OAuth code");
      return;
    }

    const token = await exchangeCode(code);
    const profile = await fetchGithubUser(token);
    const tokenEnc = encryptToken(token);

    await execute(
      `INSERT INTO users (github_id, login, name, avatar_url, access_token_enc, last_login_at)
       VALUES (?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         login = VALUES(login),
         name = VALUES(name),
         avatar_url = VALUES(avatar_url),
         access_token_enc = VALUES(access_token_enc),
         last_login_at = VALUES(last_login_at),
         id = LAST_INSERT_ID(id)`,
      [profile.id, profile.login, profile.name, profile.avatarUrl, tokenEnc],
    );

    const user = await queryOne<{ id: number }>(`SELECT id FROM users WHERE github_id = ?`, [
      profile.id,
    ]);
    if (!user) throw new Error("Failed to upsert user");

    const sessionId = crypto.randomBytes(32).toString("hex");
    await execute(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [sessionId, user.id],
    );

    res.cookie(SESSION_COOKIE, sessionId, {
      ...cookieBase(),
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });

    res.redirect(webOrigin());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth] callback failed:", message);
    res.status(400).send("GitHub authorization failed");
  }
});

router.get("/me", async (req: Request, res: Response) => {
  const user = await loadSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload: AuthMe = {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
  res.json(payload);
});

router.post("/logout", async (req: Request, res: Response) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId === "string" && sessionId) {
    await execute(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
  }
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.status(204).end();
});

export default router;
