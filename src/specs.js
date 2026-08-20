import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { deflateSync } from "node:zlib";
import { newId, sha256, slug } from "./ids.js";
import { repoContext, runGit } from "./git.js";
import { readJson, writeJson } from "./store.js";
import {
  readReconciliationState,
  writeReconciliationState,
} from "./reconcile-state.js";
import { CliError } from "./errors.js";

export const SPEC_PARSER = "stable-markdown-blocks/v1";
export const SPEC_MERGE_ALGORITHM = "stable-markdown-three-way/v1";

export function normalizeMarkdown(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

function splitLines(text) {
  return normalizeMarkdown(text).split("\n");
}

function blockContent(lines, start, endExclusive) {
  return lines.slice(start, endExclusive).join("\n").trimEnd();
}

function deterministicEntityId(artifactId, semanticKey) {
  return `ent_${sha256(`${artifactId}\0${semanticKey}`).slice(0, 24)}`;
}

function parseBlocks(text) {
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
  const firstHeading = headings[0]?.index ?? lines.length;
  const preamble = blockContent(lines, 0, firstHeading);
  if (preamble || headings.length === 0) {
    blocks.push({
      kind: "preamble",
      semanticKey: "preamble:1",
      title: "Preamble",
      level: null,
      startLine: 1,
      endLine: Math.max(1, firstHeading),
      contentHash: sha256(preamble),
    });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const endExclusive = headings[index + 1]?.index ?? lines.length;
    const content = blockContent(lines, heading.index, endExclusive);
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

function buildManifest(source, raw, options = {}) {
  const canonical = normalizeMarkdown(raw);
  const oldManifest = options.oldManifest ?? null;
  const artifactId = options.artifactId ?? oldManifest?.artifactId ?? newId("artifact");
  const priorIds = new Map(
    (oldManifest?.blocks ?? []).map((block) => [block.semanticKey, block.id]),
  );
  for (const [semanticKey, id] of options.preferredIds ?? []) {
    priorIds.set(semanticKey, id);
  }
  const blocks = parseBlocks(canonical).map((block) => ({
    id:
      priorIds.get(block.semanticKey) ??
      deterministicEntityId(artifactId, block.semanticKey),
    ...block,
  }));
  return {
    schema: "vcs-lab.spec-manifest/v2",
    artifactId,
    source,
    sourceHash: sha256(canonical),
    sourceBytes: Buffer.byteLength(canonical),
    sourceLines: splitLines(canonical).length,
    representation: "annotated-markdown",
    parser: SPEC_PARSER,
    blocks,
  };
}

export function serializeSpecManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function manifestRelativePath(source) {
  return `.vcs-lab/specs/${source}.json`;
}

export function specFilesForConflictPaths(paths) {
  const files = new Set();
  for (const file of paths) {
    if (/\.md$/i.test(file)) files.add(file);
    const match = file.match(/^\.vcs-lab\/specs\/(.+\.md)\.json$/i);
    if (match) files.add(match[1]);
  }
  return [...files].sort();
}

function relativeSpecPath(file, context, cwd) {
  const absolute = path.resolve(cwd, file);
  const relative = path.relative(context.root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliError("Specification must be inside the repository.");
  }
  return relative.split(path.sep).join("/");
}

function manifestPathFromRelative(relative, context) {
  return path.join(context.root, ".vcs-lab", "specs", `${relative}.json`);
}

export function manifestPathFor(file, cwd = process.cwd()) {
  const context = repoContext(cwd);
  const relative = relativeSpecPath(file, context, cwd);
  return manifestPathFromRelative(relative, context);
}

function changesBetween(oldManifest, manifest) {
  const oldByKey = new Map(
    (oldManifest?.blocks ?? []).map((block) => [block.semanticKey, block]),
  );
  const newKeys = new Set(manifest.blocks.map((block) => block.semanticKey));
  const changes = {
    added: [],
    removed: [],
    changed: [],
    moved: [],
    unchanged: [],
  };
  for (const block of manifest.blocks) {
    const previous = oldByKey.get(block.semanticKey);
    if (!previous) {
      changes.added.push(block.id);
      continue;
    }
    if (previous.contentHash !== block.contentHash) changes.changed.push(block.id);
    if (previous.startLine !== block.startLine) changes.moved.push(block.id);
    if (
      previous.contentHash === block.contentHash &&
      previous.startLine === block.startLine
    ) {
      changes.unchanged.push(block.id);
    }
  }
  for (const previous of oldManifest?.blocks ?? []) {
    if (!newKeys.has(previous.semanticKey)) changes.removed.push(previous.id);
  }
  return changes;
}

function indexSpecWithContext(file, context, cwd, options = {}) {
  const absolute = path.resolve(cwd, file);
  if (!fs.existsSync(absolute)) throw new CliError(`Spec not found: ${file}`);
  const relative = relativeSpecPath(file, context, cwd);
  const manifestPath = manifestPathFromRelative(relative, context);
  const oldManifest = readJson(manifestPath, null);
  const raw = normalizeMarkdown(fs.readFileSync(absolute, "utf8"));
  const sourceHash = sha256(raw);
  if (
    !options.force &&
    oldManifest?.schema === "vcs-lab.spec-manifest/v2" &&
    oldManifest?.parser === SPEC_PARSER &&
    oldManifest?.sourceHash === sourceHash
  ) {
    return {
      manifestPath,
      manifest: oldManifest,
      changes: {
        added: [],
        removed: [],
        changed: [],
        moved: [],
        unchanged: oldManifest.blocks.map((block) => block.id),
      },
      cacheHit: true,
      written: false,
    };
  }

  const manifest = buildManifest(relative, raw, { oldManifest });
  const changes = changesBetween(oldManifest, manifest);
  writeJson(manifestPath, manifest);
  return {
    manifestPath,
    manifest,
    changes,
    cacheHit: false,
    written: true,
  };
}

export function indexSpec(file, cwd = process.cwd(), options = {}) {
  const context = repoContext(cwd);
  return indexSpecWithContext(file, context, cwd, options);
}

function markdownFiles(cwd) {
  const output = runGit(
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.md",
    ],
    { cwd, trim: false },
  ).stdout;
  return output.split("\0").filter(Boolean).sort();
}

function summarizeIndexResults(results, durationMs) {
  return {
    files: results.length,
    cacheHits: results.filter((result) => result.cacheHit).length,
    manifestsWritten: results.filter((result) => result.written).length,
    blocks: results.reduce(
      (total, result) => total + result.manifest.blocks.length,
      0,
    ),
    changes: results.reduce(
      (summary, result) => {
        for (const name of ["added", "removed", "changed", "moved", "unchanged"]) {
          summary[name] += result.changes[name].length;
        }
        return summary;
      },
      { added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0 },
    ),
    durationMs: Number(durationMs.toFixed(2)),
  };
}

export function indexAllSpecs(cwd = process.cwd(), options = {}) {
  const context = repoContext(cwd);
  const files = markdownFiles(cwd);
  const started = performance.now();
  const results = files.map((file) =>
    indexSpecWithContext(file, context, context.root, options),
  );
  return {
    ...summarizeIndexResults(results, performance.now() - started),
    results,
  };
}

export function readSpecManifest(file, cwd = process.cwd()) {
  const manifestPath = manifestPathFor(file, cwd);
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    throw new CliError(`No manifest exists for '${file}'. Run 'vlab spec index ${file}'.`);
  }
  return { manifestPath, manifest };
}

function revisionFile(revision, relative, cwd) {
  const result = runGit(["show", `${revision}:${relative}`], {
    cwd,
    allowFailure: true,
    trim: false,
  });
  return result.ok ? normalizeMarkdown(result.stdout) : null;
}

function primaryBlocks(raw, manifest) {
  const lines = splitLines(raw);
  const primary = manifest.blocks
    .filter((block) => block.kind === "preamble" || block.kind === "section")
    .map((block) => {
      const content = blockContent(lines, block.startLine - 1, block.endLine);
      if (sha256(content) !== block.contentHash) {
        throw new CliError(
          `Spec manifest block '${block.id}' does not match '${manifest.source}'.`,
        );
      }
      return { ...block, content };
    });
  if (
    !primary.some((block) => block.kind === "preamble") &&
    primary[0]?.startLine > 1
  ) {
    const content = blockContent(lines, 0, primary[0].startLine - 1);
    if (content) {
      primary.unshift({
        id: deterministicEntityId(manifest.artifactId, "preamble:1"),
        kind: "preamble",
        semanticKey: "preamble:1",
        title: "Preamble",
        level: null,
        startLine: 1,
        endLine: primary[0].startLine - 1,
        contentHash: sha256(content),
        content,
      });
    }
  }
  const ids = new Set();
  for (const block of primary) {
    if (ids.has(block.id)) {
      throw new CliError(`Spec manifest for '${manifest.source}' has duplicate block IDs.`);
    }
    ids.add(block.id);
  }
  return primary;
}

function revisionStage(file, revision, cwd) {
  const raw = revisionFile(revision, file, cwd);
  const manifestFile = manifestRelativePath(file);
  const manifestRaw = revisionFile(revision, manifestFile, cwd);
  if (raw === null) {
    return {
      revision,
      exists: false,
      raw: null,
      sourceHash: null,
      manifest: null,
      manifestHash: manifestRaw === null ? null : sha256(manifestRaw),
      blocks: [],
    };
  }
  if (manifestRaw === null) {
    throw new CliError(
      `No committed spec manifest exists for '${file}' at ${revision}.`,
      { details: `Index and commit it with: vlab spec index ${file}` },
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new CliError(`Spec manifest for '${file}' at ${revision} is invalid JSON.`);
  }
  if (manifest.source !== file) {
    throw new CliError(`Spec manifest source does not match '${file}' at ${revision}.`);
  }
  const normalizedHash = sha256(raw);
  const compatibleHashes = [normalizedHash];
  if (manifest.schema === "vcs-lab.spec-manifest/v1") {
    compatibleHashes.push(sha256(raw.replace(/\n/g, "\r\n")));
  }
  if (!compatibleHashes.includes(manifest.sourceHash)) {
    throw new CliError(`Spec manifest for '${file}' is stale at ${revision}.`, {
      details: `Re-index and commit it with: vlab spec index ${file}`,
    });
  }
  return {
    revision,
    exists: true,
    raw,
    sourceHash: normalizedHash,
    manifest,
    manifestHash: sha256(manifestRaw),
    blocks: primaryBlocks(raw, manifest),
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function contentDecision(id, base, ours, theirs) {
  const same = (left, right) => left?.contentHash === right?.contentHash;
  if (base) {
    if (!ours && !theirs) return { id, outcome: "deleted-both", block: null };
    if (!ours) {
      if (same(base, theirs)) return { id, outcome: "deleted-ours", block: null };
      return {
        id,
        outcome: "conflict",
        conflict: "delete-vs-edit",
        deletedBy: "ours",
        block: null,
      };
    }
    if (!theirs) {
      if (same(base, ours)) return { id, outcome: "deleted-theirs", block: null };
      return {
        id,
        outcome: "conflict",
        conflict: "delete-vs-edit",
        deletedBy: "theirs",
        block: null,
      };
    }
    const oursChanged = !same(base, ours);
    const theirsChanged = !same(base, theirs);
    if (!oursChanged && !theirsChanged) {
      return { id, outcome: "unchanged", block: ours };
    }
    if (oursChanged && !theirsChanged) {
      return { id, outcome: "ours-edit", block: ours };
    }
    if (!oursChanged && theirsChanged) {
      return { id, outcome: "theirs-edit", block: theirs };
    }
    if (same(ours, theirs)) {
      return { id, outcome: "identical-edit", block: ours };
    }
    return {
      id,
      outcome: "conflict",
      conflict: "same-block-edit",
      block: null,
    };
  }
  if (ours && theirs) {
    if (same(ours, theirs)) {
      return { id, outcome: "identical-add", block: ours };
    }
    return {
      id,
      outcome: "conflict",
      conflict: "same-block-concurrent-add",
      block: null,
    };
  }
  if (ours) return { id, outcome: "ours-add", block: ours };
  return { id, outcome: "theirs-add", block: theirs };
}

function orderAdded(stage, skeletonSet) {
  const groups = new Map();
  let anchor = "__start__";
  for (const block of stage.blocks) {
    if (skeletonSet.has(block.id)) {
      anchor = block.id;
      continue;
    }
    const items = groups.get(anchor) ?? [];
    items.push(block.id);
    groups.set(anchor, items);
  }
  return groups;
}

function addedAnchors(groups) {
  const anchors = new Map();
  for (const [anchor, ids] of groups) {
    for (const id of ids) anchors.set(id, anchor);
  }
  return anchors;
}

function mergeOrder(base, ours, theirs, chosen) {
  const chosenIds = new Set(chosen.keys());
  const baseIds = base.blocks.map((block) => block.id).filter((id) => chosenIds.has(id));
  const baseSet = new Set(baseIds);
  const oursProjection = ours.blocks
    .map((block) => block.id)
    .filter((id) => baseSet.has(id));
  const theirsProjection = theirs.blocks
    .map((block) => block.id)
    .filter((id) => baseSet.has(id));
  let skeleton;
  let orderDecision;
  if (sameArray(oursProjection, theirsProjection)) {
    skeleton = oursProjection;
    orderDecision = sameArray(baseIds, oursProjection)
      ? "unchanged"
      : "same-move";
  } else if (sameArray(oursProjection, baseIds)) {
    skeleton = theirsProjection;
    orderDecision = "theirs-move";
  } else if (sameArray(theirsProjection, baseIds)) {
    skeleton = oursProjection;
    orderDecision = "ours-move";
  } else {
    return {
      order: [],
      decision: "conflict",
      conflicts: [{ type: "conflicting-block-order" }],
    };
  }

  const skeletonSet = new Set(skeleton);
  const oursAdded = orderAdded(ours, skeletonSet);
  const theirsAdded = orderAdded(theirs, skeletonSet);
  const oursAnchors = addedAnchors(oursAdded);
  const theirsAnchors = addedAnchors(theirsAdded);
  for (const id of chosenIds) {
    if (baseSet.has(id)) continue;
    if (
      oursAnchors.has(id) &&
      theirsAnchors.has(id) &&
      oursAnchors.get(id) !== theirsAnchors.get(id)
    ) {
      return {
        order: [],
        decision: "conflict",
        conflicts: [{ type: "concurrent-add-placement", blockId: id }],
      };
    }
  }
  for (const anchor of new Set([...oursAdded.keys(), ...theirsAdded.keys()])) {
    const oursItems = (oursAdded.get(anchor) ?? []).filter((id) =>
      theirsAnchors.has(id),
    );
    const theirsItems = (theirsAdded.get(anchor) ?? []).filter((id) =>
      oursAnchors.has(id),
    );
    if (!sameArray(oursItems, theirsItems)) {
      return {
        order: [],
        decision: "conflict",
        conflicts: [{ type: "conflicting-added-block-order", anchor }],
      };
    }
  }
  const appendGroup = (output, anchor) => {
    const oursItems = oursAdded.get(anchor) ?? [];
    const theirsItems = theirsAdded.get(anchor) ?? [];
    for (const id of [...oursItems, ...theirsItems]) {
      if (chosenIds.has(id) && !output.includes(id)) output.push(id);
    }
  };
  const order = [];
  appendGroup(order, "__start__");
  for (const id of skeleton) {
    if (!order.includes(id)) order.push(id);
    appendGroup(order, id);
  }
  for (const id of chosenIds) {
    if (!order.includes(id)) order.push(id);
  }
  return { order, decision: orderDecision, conflicts: [] };
}

function decisionCounts(decisions) {
  const counts = {};
  for (const decision of decisions) {
    const key = decision.conflict ?? decision.outcome;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function stageFingerprint(stage) {
  return {
    exists: stage.exists,
    sourceHash: stage.sourceHash,
    manifestHash: stage.manifestHash,
  };
}

export function planSpecMerge(
  file,
  baseRevision,
  oursRevision,
  theirsRevision,
  cwd = process.cwd(),
) {
  const context = repoContext(cwd);
  const relative = relativeSpecPath(file, context, cwd);
  if (!/\.md$/i.test(relative)) {
    throw new CliError("Semantic spec merge currently supports Markdown files only.");
  }
  const manifestFile = manifestRelativePath(relative);
  let base;
  let ours;
  let theirs;
  try {
    base = revisionStage(relative, baseRevision, cwd);
    ours = revisionStage(relative, oursRevision, cwd);
    theirs = revisionStage(relative, theirsRevision, cwd);
  } catch (error) {
    return {
      schema: "vcs-lab.spec-merge-plan/v1",
      algorithm: SPEC_MERGE_ALGORITHM,
      status: "blocked",
      file: relative,
      manifestFile,
      artifactId: null,
      signature: null,
      revisions: { base: baseRevision, ours: oursRevision, theirs: theirsRevision },
      base: null,
      ours: null,
      theirs: null,
      decisions: [],
      counts: { "semantic-metadata-unavailable": 1 },
      ordering: { decision: "not-evaluated", order: [] },
      conflicts: [
        {
          type: "semantic-metadata-unavailable",
          message: error.message,
        },
      ],
      result: null,
    };
  }
  const artifacts = new Set(
    [base, ours, theirs]
      .map((stage) => stage.manifest?.artifactId)
      .filter(Boolean),
  );
  if (artifacts.size !== 1) {
    return {
      schema: "vcs-lab.spec-merge-plan/v1",
      algorithm: SPEC_MERGE_ALGORITHM,
      status: "blocked",
      file: relative,
      manifestFile,
      artifactId: null,
      signature: null,
      base: stageFingerprint(base),
      ours: stageFingerprint(ours),
      theirs: stageFingerprint(theirs),
      decisions: [],
      counts: { "artifact-identity-mismatch": 1 },
      ordering: { decision: "not-evaluated" },
      conflicts: [{ type: "artifact-identity-mismatch" }],
      result: null,
    };
  }
  const artifactId = [...artifacts][0];
  const signature = `ssig_${sha256(JSON.stringify({
    algorithm: SPEC_MERGE_ALGORITHM,
    artifactId,
    base: stageFingerprint(base),
    ours: stageFingerprint(ours),
    theirs: stageFingerprint(theirs),
  }))}`;
  const byId = (stage) => new Map(stage.blocks.map((block) => [block.id, block]));
  const baseById = byId(base);
  const oursById = byId(ours);
  const theirsById = byId(theirs);
  const ids = new Set([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
  const decisions = [...ids].map((id) =>
    contentDecision(id, baseById.get(id), oursById.get(id), theirsById.get(id)),
  );
  const chosen = new Map(
    decisions.filter((decision) => decision.block).map((decision) => [decision.id, decision.block]),
  );
  const conflicts = decisions
    .filter((decision) => decision.conflict)
    .map((decision) => ({
      type: decision.conflict,
      blockId: decision.id,
      semanticKey:
        baseById.get(decision.id)?.semanticKey ??
        oursById.get(decision.id)?.semanticKey ??
        theirsById.get(decision.id)?.semanticKey ??
        null,
      title:
        baseById.get(decision.id)?.title ??
        oursById.get(decision.id)?.title ??
        theirsById.get(decision.id)?.title ??
        null,
      deletedBy: decision.deletedBy ?? null,
    }));
  const ordering = mergeOrder(base, ours, theirs, chosen);
  conflicts.push(...ordering.conflicts);
  const counts = decisionCounts(decisions);
  if (ordering.conflicts.length) {
    counts[ordering.conflicts[0].type] =
      (counts[ordering.conflicts[0].type] ?? 0) + 1;
  }

  let result = null;
  if (conflicts.length === 0) {
    const ordered = ordering.order.map((id) => chosen.get(id)).filter(Boolean);
    const deleted = ordered.length === 0 && (!ours.exists || !theirs.exists);
    if (deleted) {
      result = {
        deleted: true,
        markdown: null,
        manifest: null,
        markdownHash: null,
        manifestHash: null,
      };
    } else {
      const markdown = `${ordered.map((block) => block.content.trimEnd()).join("\n\n").trimEnd()}\n`;
      const preferredIdMap = new Map();
      for (const stage of [base, ours, theirs]) {
        for (const block of stage.manifest?.blocks ?? []) {
          if (!preferredIdMap.has(block.semanticKey)) {
            preferredIdMap.set(block.semanticKey, block.id);
          }
        }
      }
      for (const block of ordered) {
        preferredIdMap.set(block.semanticKey, block.id);
      }
      const manifest = buildManifest(relative, markdown, {
        artifactId,
        preferredIds: preferredIdMap,
      });
      const manifestText = serializeSpecManifest(manifest);
      result = {
        deleted: false,
        markdown,
        manifest,
        markdownHash: sha256(markdown),
        manifestHash: sha256(manifestText),
      };
    }
  }

  return {
    schema: "vcs-lab.spec-merge-plan/v1",
    algorithm: SPEC_MERGE_ALGORITHM,
    status: conflicts.length ? "blocked" : "clean",
    file: relative,
    manifestFile,
    artifactId,
    signature,
    revisions: { base: baseRevision, ours: oursRevision, theirs: theirsRevision },
    base: stageFingerprint(base),
    ours: stageFingerprint(ours),
    theirs: stageFingerprint(theirs),
    decisions: decisions.map(({ block, ...decision }) => decision),
    counts,
    ordering: { decision: ordering.decision, order: ordering.order },
    conflicts,
    result,
  };
}

export function materializeSpecMerge(plan, cwd = process.cwd()) {
  if (plan.status !== "clean" || !plan.result) {
    throw new CliError(`Spec merge for '${plan.file}' is not clean.`);
  }
  if (plan.result.deleted) {
    runGit(["rm", "--ignore-unmatch", "--", plan.file, plan.manifestFile], { cwd });
    return;
  }
  const markdownPath = path.resolve(cwd, plan.file);
  const manifestPath = path.resolve(cwd, plan.manifestFile);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(markdownPath, plan.result.markdown);
  writeJson(manifestPath, plan.result.manifest);
  runGit(["add", "--", plan.file, plan.manifestFile], { cwd });
}

export function compactSpecMerge(plan, selectionMethod = null) {
  return {
    path: plan.file,
    manifestPath: plan.manifestFile,
    signature: plan.signature,
    algorithm: plan.algorithm,
    status: plan.status,
    counts: plan.counts,
    ordering: plan.ordering.decision,
    conflicts: plan.conflicts,
    resultMarkdownHash: plan.result?.markdownHash ?? null,
    resultManifestHash: plan.result?.manifestHash ?? null,
    resolvedPaths: [plan.file, plan.manifestFile],
    selectionMethod,
  };
}

function stagedFile(file, cwd) {
  const result = runGit(["show", `:${file}`], {
    cwd,
    allowFailure: true,
    trim: false,
  });
  return result.ok ? normalizeMarkdown(result.stdout) : null;
}

export function captureSpecMergeOutcomes(merges, cwd = process.cwd()) {
  return merges.map((merge) => {
    const markdown = stagedFile(merge.path, cwd);
    const manifest = stagedFile(merge.manifestPath, cwd);
    if ((markdown === null) !== (manifest === null)) {
      throw new CliError(
        `Staged spec '${merge.path}' and its manifest must be added or deleted together.`,
      );
    }
    if (markdown !== null) {
      let parsed;
      try {
        parsed = JSON.parse(manifest);
      } catch {
        throw new CliError(`Staged manifest for '${merge.path}' is invalid JSON.`);
      }
      if (parsed.source !== merge.path || parsed.sourceHash !== sha256(markdown)) {
        throw new CliError(`Staged manifest for '${merge.path}' is stale.`, {
          details: `Run 'vlab spec index ${merge.path}', stage both files, and continue again.`,
        });
      }
      primaryBlocks(markdown, parsed);
    }
    const actualMarkdownHash = markdown === null ? null : sha256(markdown);
    const actualManifestHash = manifest === null ? null : sha256(manifest);
    const accepted =
      actualMarkdownHash === merge.resultMarkdownHash &&
      actualManifestHash === merge.resultManifestHash;
    return {
      ...merge,
      decision: accepted ? "accepted" : "modified",
      actualMarkdownHash,
      actualManifestHash,
    };
  });
}

export function specMergePlansForOperation(operation, cwd = process.cwd()) {
  if (!operation?.current) return [];
  const markdown = specFilesForConflictPaths(
    operation.current.conflictedPaths ?? [],
  );
  return markdown.map((file) =>
    planSpecMerge(
      file,
      `${operation.current.sourceCommit}^`,
      operation.current.targetBefore,
      operation.current.sourceCommit,
      cwd,
    ),
  );
}

export function pendingSpecMergeStatus(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = readReconciliationState(cwd);
  const plans = specMergePlansForOperation(operation, cwd);
  return {
    active: plans.length > 0,
    operationId: operation?.id ?? null,
    plans: plans.map((plan) => compactSpecMerge(plan)),
  };
}

export function applyPendingSpecMerges(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = readReconciliationState(cwd);
  if (!operation?.current) {
    throw new CliError("No reconciliation conflict is pending in this worktree.");
  }
  let plans = specMergePlansForOperation(operation, cwd);
  if (options.path) plans = plans.filter((plan) => plan.file === options.path);
  if (plans.length === 0) {
    throw new CliError("No semantic specification merge is pending.");
  }
  if (!options.all && !options.path && plans.length !== 1) {
    throw new CliError("Choose a spec path or pass --all.");
  }
  if (!options.all && options.path && plans.length === 0) {
    throw new CliError(`'${options.path}' is not a pending spec conflict.`);
  }
  const blocked = plans.filter((plan) => plan.status !== "clean");
  if (blocked.length) {
    throw new CliError("One or more spec merges require manual review.", {
      details: blocked
        .map((plan) => `${plan.file}: ${plan.conflicts.map((item) => item.type).join(", ")}`)
        .join("\n"),
    });
  }
  const applied = [];
  for (const plan of plans) {
    materializeSpecMerge(plan, cwd);
    applied.push(compactSpecMerge(plan, "explicit-spec-merge"));
  }
  operation.current.semanticMerges = [
    ...(operation.current.semanticMerges ?? []).filter(
      (existing) => !applied.some((item) => item.path === existing.path),
    ),
    ...applied,
  ];
  writeReconciliationState(operation, cwd);
  return { operationId: operation.id, applied };
}

function corpusDocument(documentIndex, blocks) {
  const sections = [];
  for (let block = 0; block < blocks; block += 1) {
    sections.push(
      `## Capability ${documentIndex}-${block}\n\n` +
      `REQ-D${documentIndex}-B${block}: The capability must remain deterministic.\n\n` +
      `Generated design context for block ${block}.`,
    );
  }
  return `# Specification ${documentIndex}\n\n${sections.join("\n\n")}\n`;
}

export function benchmarkSpecIndex(options = {}) {
  const readSize = (value, fallback, name) => {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 1_000) {
      throw new CliError(`${name} must be an integer between 1 and 1000.`);
    }
    return number;
  };
  const documents = readSize(options.documents, 25, "--documents");
  const blocksPerDocument = readSize(options.blocks, 40, "--blocks");
  if (documents * blocksPerDocument > 100_000) {
    throw new CliError("The benchmark is limited to 100,000 generated blocks.");
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-lab-spec-benchmark-"));
  try {
    runGit(["init", "-q", "-b", "main"], { cwd: temporary });
    const context = repoContext(temporary);
    const files = [];
    for (let index = 0; index < documents; index += 1) {
      const relative = `docs/generated-${index}.md`;
      const absolute = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, corpusDocument(index, blocksPerDocument));
      files.push(relative);
    }
    const run = () => {
      const started = performance.now();
      const results = files.map((file) =>
        indexSpecWithContext(file, context, temporary),
      );
      return summarizeIndexResults(results, performance.now() - started);
    };
    const cold = run();
    const unchanged = run();
    const changedFile = files[Math.floor(files.length / 2)];
    const changedPath = path.join(temporary, changedFile);
    const original = fs.readFileSync(changedPath, "utf8");
    fs.writeFileSync(
      changedPath,
      original.replace(
        "The capability must remain deterministic.",
        "The capability must remain deterministic and auditable.",
      ),
    );
    const oneBlockChanged = run();
    const sourceFiles = files.map((file) =>
      fs.readFileSync(path.join(temporary, file)),
    );
    const manifestFiles = files.map((file) =>
      fs.readFileSync(manifestPathFromRelative(file, context)),
    );
    const sourceBytes = sourceFiles.reduce((total, value) => total + value.length, 0);
    const manifestBytes = manifestFiles.reduce((total, value) => total + value.length, 0);
    const compressedSourceBytes = sourceFiles.reduce(
      (total, value) => total + deflateSync(value).length,
      0,
    );
    const compressedManifestBytes = manifestFiles.reduce(
      (total, value) => total + deflateSync(value).length,
      0,
    );
    return {
      schema: "vcs-lab.spec-benchmark/v1",
      documents,
      blocksPerDocument,
      semanticEntities: cold.blocks,
      sourceBytes,
      manifestBytes,
      manifestToSourceRatio: Number((manifestBytes / sourceBytes).toFixed(3)),
      estimatedCompressedSourceBytes: compressedSourceBytes,
      estimatedCompressedManifestBytes: compressedManifestBytes,
      estimatedCompressedManifestToSourceRatio: Number(
        (compressedManifestBytes / compressedSourceBytes).toFixed(3),
      ),
      cold,
      unchanged,
      oneBlockChanged,
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
