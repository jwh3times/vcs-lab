import fs from "node:fs";
import path from "node:path";
import { newId, sha256, slug } from "./ids.js";
import { repoContext } from "./git.js";
import { readJson, writeJson } from "./store.js";
import { CliError } from "./errors.js";

function splitLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function semanticBlocks(text) {
  const lines = splitLines(text);
  const headings = [];
  const occurrence = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].replace(/\s+#+\s*$/, "").trim();
    const baseKey = `section:${level}:${slug(title)}`;
    const number = (occurrence.get(baseKey) ?? 0) + 1;
    occurrence.set(baseKey, number);
    headings.push({ index, level, title, semanticKey: `${baseKey}:${number}` });
  }

  const blocks = [];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const endExclusive = headings[i + 1]?.index ?? lines.length;
    const content = lines.slice(heading.index, endExclusive).join("\n").trimEnd();
    blocks.push({
      kind: "section",
      semanticKey: heading.semanticKey,
      title: heading.title,
      level: heading.level,
      startLine: heading.index + 1,
      endLine: Math.max(heading.index + 1, endExclusive),
      contentHash: sha256(content),
    });
  }

  const reqOccurrence = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(REQ-[A-Za-z0-9._-]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const requirement = match[1].toUpperCase();
    const number = (reqOccurrence.get(requirement) ?? 0) + 1;
    reqOccurrence.set(requirement, number);
    blocks.push({
      kind: "requirement",
      semanticKey: `requirement:${requirement}:${number}`,
      title: requirement,
      level: null,
      startLine: index + 1,
      endLine: index + 1,
      contentHash: sha256(lines[index].trim()),
    });
  }

  return blocks.sort((left, right) =>
    left.startLine - right.startLine || left.kind.localeCompare(right.kind),
  );
}

export function manifestPathFor(file, cwd = process.cwd()) {
  const context = repoContext(cwd);
  const absolute = path.resolve(cwd, file);
  const relative = path.relative(context.root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliError("Specification must be inside the repository.");
  }
  return path.join(context.root, ".vcs-lab", "specs", `${relative}.json`);
}

export function indexSpec(file, cwd = process.cwd()) {
  const context = repoContext(cwd);
  const absolute = path.resolve(cwd, file);
  if (!fs.existsSync(absolute)) throw new CliError(`Spec not found: ${file}`);
  const relative = path.relative(context.root, absolute).split(path.sep).join("/");
  const manifestPath = manifestPathFor(file, cwd);
  const oldManifest = readJson(manifestPath, null);
  const oldByKey = new Map(
    (oldManifest?.blocks ?? []).map((block) => [block.semanticKey, block]),
  );
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = semanticBlocks(raw);
  const blocks = parsed.map((block) => ({
    id: oldByKey.get(block.semanticKey)?.id ?? newId("ent"),
    ...block,
  }));
  const newKeys = new Set(blocks.map((block) => block.semanticKey));

  const changes = {
    added: [],
    removed: [],
    changed: [],
    moved: [],
    unchanged: [],
  };
  for (const block of blocks) {
    const previous = oldByKey.get(block.semanticKey);
    if (!previous) {
      changes.added.push(block.id);
    } else {
      if (previous.contentHash !== block.contentHash) changes.changed.push(block.id);
      if (previous.startLine !== block.startLine) changes.moved.push(block.id);
      if (
        previous.contentHash === block.contentHash &&
        previous.startLine === block.startLine
      ) {
        changes.unchanged.push(block.id);
      }
    }
  }
  for (const previous of oldManifest?.blocks ?? []) {
    if (!newKeys.has(previous.semanticKey)) changes.removed.push(previous.id);
  }

  const manifest = {
    schema: "vcs-lab.spec-manifest/v1",
    artifactId: oldManifest?.artifactId ?? newId("artifact"),
    source: relative,
    sourceHash: sha256(raw),
    indexedAt: new Date().toISOString(),
    representation: "annotated-markdown",
    blocks,
  };
  writeJson(manifestPath, manifest);
  return { manifestPath, manifest, changes };
}

export function readSpecManifest(file, cwd = process.cwd()) {
  const manifestPath = manifestPathFor(file, cwd);
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    throw new CliError(`No manifest exists for '${file}'. Run 'vlab spec index ${file}'.`);
  }
  return { manifestPath, manifest };
}
