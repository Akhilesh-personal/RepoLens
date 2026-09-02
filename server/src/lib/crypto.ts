import "./env.js";
import crypto from "node:crypto";

function keyBytes(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY?.trim();
  if (!raw) throw new Error("TOKEN_ENC_KEY is not set");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const fromB64 = Buffer.from(raw, "base64");
  if (fromB64.length === 32) return fromB64;
  throw new Error("TOKEN_ENC_KEY must be 32 bytes (64 hex characters or base64)");
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(packed: string): string {
  const [ivB64, tagB64, dataB64] = packed.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
