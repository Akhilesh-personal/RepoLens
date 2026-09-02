import type { NextFunction, Request, Response } from "express";
import type { AuthUser, SessionUserRow } from "shared";
import { queryOne } from "./db.js";

export async function loadSessionUser(req: Request): Promise<AuthUser | null> {
  const sessionId = req.cookies?.rl_session;
  if (!sessionId || typeof sessionId !== "string") return null;

  const row = await queryOne<SessionUserRow>(
    `SELECT s.id AS session_id, u.id, u.login, u.name, u.avatar_url
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > NOW()`,
    [sessionId],
  );
  if (!row) return null;

  return {
    id: row.id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = user;
    next();
  } catch (err: unknown) {
    next(err);
  }
}
