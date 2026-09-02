import { requiredEnv } from "./env.js";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { SqlParams } from "shared";

const globalForMysql = globalThis as unknown as { repolensPool?: Pool };

function getPool(): Pool {
  if (!globalForMysql.repolensPool) {
    const port = Number(process.env.DB_PORT ?? 3306);
    globalForMysql.repolensPool = mysql.createPool({
      host: requiredEnv("DB_HOST"),
      port: Number.isFinite(port) ? port : 3306,
      user: requiredEnv("DB_USER"),
      password: process.env.DB_PASSWORD ?? "",
      database: requiredEnv("DB_NAME"),
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
      dateStrings: true,
    });
  }
  return globalForMysql.repolensPool;
}

export function placeholders(count: number): string {
  if (count < 1) throw new Error("placeholders requires count >= 1");
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function query<T>(sql: string, params: SqlParams = []): Promise<T[]> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T>(sql: string, params: SqlParams = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params);
  return result;
}

export async function insert(sql: string, params: SqlParams = []): Promise<number> {
  const result = await execute(sql, params);
  return result.insertId;
}

/** Bulk writes with many value tuples. Uses query() rather than execute(). */
export async function execMany(sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await getPool().query<ResultSetHeader>(sql, params);
  return result;
}

export async function execSql(sql: string): Promise<void> {
  await getPool().query(sql);
}
