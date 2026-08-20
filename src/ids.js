import { createHash, randomBytes } from "node:crypto";

export function newId(prefix) {
  const time = Date.now().toString(36).padStart(9, "0");
  const random = randomBytes(6).toString("hex");
  return `${prefix}_${time}${random}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function gitBlobId(value, algorithm = "sha1") {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash(algorithm).update(header).update(content).digest("hex");
}

export function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}
