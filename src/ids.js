import { createHash, randomBytes } from "node:crypto";

export function newId(prefix) {
  const time = Date.now().toString(36).padStart(9, "0");
  const random = randomBytes(6).toString("hex");
  return `${prefix}_${time}${random}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}
