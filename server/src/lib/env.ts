import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
];

for (const file of candidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function webOrigin(): string {
  return requiredEnv("WEB_ORIGIN").replace(/\/$/, "");
}

export function oauthRedirectUri(): string {
  return `${webOrigin()}/api/auth/callback`;
}
