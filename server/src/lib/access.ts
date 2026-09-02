import type { Request } from "express";
import type { AuthUser, RepoIdRow } from "shared";
import { decryptToken } from "./crypto.js";
import { queryOne } from "./db.js";

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new Error("Unauthenticated");
  return req.user;
}

export async function userRepoBySlug(userId: number, slug: string): Promise<RepoIdRow | null> {
  return queryOne<RepoIdRow>(
    `SELECT r.id
     FROM repos r
     INNER JOIN user_repos ur ON ur.repo_id = r.id
     WHERE ur.user_id = ? AND r.slug = ?`,
    [userId, slug],
  );
}

export async function accessTokenForUser(userId: number): Promise<string> {
  const row = await queryOne<{ access_token_enc: string }>(
    `SELECT access_token_enc FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) throw new Error("User not found");
  return decryptToken(row.access_token_enc);
}

export async function accessTokenForRepo(repoId: number): Promise<string> {
  const row = await queryOne<{ access_token_enc: string }>(
    `SELECT u.access_token_enc
     FROM users u
     INNER JOIN user_repos ur ON ur.user_id = u.id
     WHERE ur.repo_id = ?
     ORDER BY u.last_login_at DESC
     LIMIT 1`,
    [repoId],
  );
  if (!row) throw new Error("No GitHub token available for this repository");
  return decryptToken(row.access_token_enc);
}
