import { execSql, query } from "./db.js";

/** Creates OAuth tables when missing. Existing databases already have these. */
export async function ensureAuthTables(): Promise<void> {
  await execSql(`
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      github_id BIGINT NOT NULL,
      login VARCHAR(255) NOT NULL,
      name VARCHAR(255) NULL,
      avatar_url TEXT NULL,
      access_token_enc TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_login_at DATETIME(3) NULL,
      UNIQUE KEY users_github_id (github_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execSql(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(64) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      KEY sessions_user_id (user_id),
      KEY sessions_expires_at (expires_at),
      CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execSql(`
    CREATE TABLE IF NOT EXISTS user_repos (
      user_id INT NOT NULL,
      repo_id INT NOT NULL,
      seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, repo_id),
      KEY user_repos_repo_id (repo_id),
      CONSTRAINT user_repos_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_repos_repo_fk FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const pushedAt = await query<{ count: number | string }>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'repos'
       AND COLUMN_NAME = 'pushed_at'`,
  );
  if (Number(pushedAt[0]?.count ?? 0) === 0) {
    await execSql(`ALTER TABLE repos ADD COLUMN pushed_at DATETIME(3) NULL`);
  }

  const githubSize = await query<{ count: number | string }>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'repos'
       AND COLUMN_NAME = 'github_size'`,
  );
  if (Number(githubSize[0]?.count ?? 0) === 0) {
    await execSql(`ALTER TABLE repos ADD COLUMN github_size INT NOT NULL DEFAULT 0`);
  }
}
