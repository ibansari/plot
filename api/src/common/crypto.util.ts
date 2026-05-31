import * as crypto from "crypto";
import { config } from "./config";

// AES-256-GCM at-rest encryption for PRIVATE data (member origin coordinates, connector
// credentials). Used so coordinates/secrets are never stored in plaintext and never need to appear
// in group DTOs, audit payloads, or render envelopes (§Privacy and Credential Rules).
const KEY = crypto.createHash("sha256").update(config.encryptionKey).digest(); // 32 bytes

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(blob: string): T {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8")) as T;
}
