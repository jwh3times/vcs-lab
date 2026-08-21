import fs from "node:fs";
import path from "node:path";
import { readGitBlob, readGitObjects, refExists, resolveRevision, runGit } from "./git.js";
import { newId } from "./ids.js";
import { appendNote, readNote } from "./notes.js";
import { acceptedCausalRecords } from "./metadata.js";
import {
  RESOLUTION_SIGNATURE_ALGORITHM,
  resolutionSignatureFor,
} from "./schemas.js";
import {
  readPendingOperation,
  writePendingOperation,
} from "./pending-operation.js";
import { CliError } from "./errors.js";

const RESOLUTION_REFS = "refs/vcs-lab/resolutions";

function parseIndexEntries(output) {
  const entries = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, blob, stageText] = record.slice(0, tab).split(/\s+/);
    entries.push({
      mode,
      blob,
      stage: Number(stageText),
      path: record.slice(tab + 1),
    });
  }
  return entries;
}

function conflictStages(filePath, cwd) {
  const output = runGit(["ls-files", "-u", "-z", "--", filePath], {
    cwd,
    trim: false,
  }).stdout;
  const byStage = new Map(
    parseIndexEntries(output).map((entry) => [entry.stage, entry]),
  );
  const compact = (stage) => {
    const entry = byStage.get(stage);
    return entry ? { mode: entry.mode, blob: entry.blob } : null;
  };
  return {
    base: compact(1),
    ours: compact(2),
    theirs: compact(3),
  };
}

function compactResolution(record) {
  return {
    id: record.id,
    signature: record.signature,
    resultBlob: record.resultBlob ?? null,
    resultMode: record.resultMode ?? null,
    ref: record.ref,
    originalPath: record.originalPath ?? null,
    createdAt: record.createdAt ?? null,
  };
}

export function listResolutionRecords(cwd = process.cwd()) {
  const refs = runGit(
    ["for-each-ref", "--format=%(refname)", RESOLUTION_REFS],
    { cwd, allowFailure: true },
  ).stdout;
  if (!refs) return [];
  const records = [];
  for (const ref of refs.split(/\r?\n/).filter(Boolean)) {
    const commit = resolveRevision(ref, cwd);
    for (const record of readNote(commit, cwd).records) {
      if (record.type === "resolution") {
        records.push({ ...record, attachedTo: commit, discoveredRef: ref, commit });
      }
    }
  }
  const accepted = acceptedCausalRecords(records, cwd).filter((record) =>
    record.ref === record.discoveredRef &&
    record.resolutionCommit === record.commit &&
    resolutionSignatureFor(record) === record.signature,
  );
  const retained = readGitObjects(
    accepted.filter((record) => record.resultBlob).map((record) => `${record.commit}:result`),
    cwd,
  );
  let retainedIndex = 0;
  return accepted.filter((record) => {
    if (!record.resultBlob) return true;
    const object = retained[retainedIndex++];
    return object?.exists && object.type === "blob" && object.oid === record.resultBlob;
  }).sort((left, right) =>
    String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
  );
}

export function resolutionCandidates(signature, cwd = process.cwd()) {
  return listResolutionRecords(cwd)
    .filter((record) => record.signature === signature)
    .map(compactResolution);
}

export function captureConflictDescriptors(paths, cwd = process.cwd()) {
  return paths.map((filePath) => {
    const stages = conflictStages(filePath, cwd);
    const signature = resolutionSignatureFor(stages);
    return {
      path: filePath,
      signature,
      algorithm: RESOLUTION_SIGNATURE_ALGORITHM,
      ...stages,
      candidates: resolutionCandidates(signature, cwd),
      selectedResolutionId: null,
      decisionOverride: null,
    };
  });
}

function stagedResult(filePath, cwd) {
  const output = runGit(["ls-files", "--stage", "-z", "--", filePath], {
    cwd,
    trim: false,
  }).stdout;
  const entry = parseIndexEntries(output).find((item) => item.stage === 0);
  return entry ? { resultMode: entry.mode, resultBlob: entry.blob } : {
    resultMode: null,
    resultBlob: null,
  };
}

export function captureResolutionOutcomes(conflicts, cwd = process.cwd()) {
  return conflicts.map((conflict) => {
    const result = stagedResult(conflict.path, cwd);
    const matching = conflict.candidates.find(
      (candidate) => candidate.resultBlob === result.resultBlob,
    );
    const selected = conflict.candidates.find(
      (candidate) => candidate.id === conflict.selectedResolutionId,
    );
    let decision = "created";
    if (conflict.candidates.length) {
      if (conflict.decisionOverride === "rejected") {
        decision = "rejected";
      } else if (selected) {
        decision = selected.resultBlob === result.resultBlob
          ? "accepted"
          : "modified";
      } else {
        decision = matching ? "accepted" : "rejected";
      }
    }
    return {
      path: conflict.path,
      signature: conflict.signature,
      algorithm: conflict.algorithm,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      ...result,
      decision,
      selectionMethod: conflict.selectionMethod ?? null,
      selectedResolutionId: selected?.id ?? null,
      reusedResolutionId: matching?.id ?? null,
    };
  });
}

function resolutionRef(outcome) {
  return `${RESOLUTION_REFS}/${outcome.signature}/${outcome.resultBlob ?? "deleted"}`;
}

function treeForResolution(outcome, cwd) {
  if (!outcome.resultBlob) {
    return runGit(["mktree"], { cwd, input: "" }).stdout;
  }
  const mode = ["100644", "100755"].includes(outcome.resultMode)
    ? outcome.resultMode
    : "100644";
  return runGit(["mktree", "-z"], {
    cwd,
    input: `${mode} blob ${outcome.resultBlob}\tresult\0`,
  }).stdout;
}

export function publishResolution(outcome, application, cwd = process.cwd()) {
  const ref = resolutionRef(outcome);
  if (refExists(ref, cwd)) {
    const existingCommit = resolveRevision(ref, cwd);
    const existing = readNote(existingCommit, cwd).records.find(
      (record) => record.type === "resolution",
    );
    if (existing) return { ...existing, ref, commit: existingCommit };
  }

  const tree = treeForResolution(outcome, cwd);
  const message = [
    `Conflict resolution ${outcome.signature.slice(0, 20)}`,
    "",
    `Resolution-Signature: ${outcome.signature}`,
    `Result-Blob: ${outcome.resultBlob ?? "deleted"}`,
  ].join("\n");
  const commit = runGit(["commit-tree", tree, "-F", "-"], {
    cwd,
    input: `${message}\n`,
  }).stdout;
  runGit(["update-ref", ref, commit], { cwd });
  const record = {
    schema: "vcs-lab.resolution/v1",
    type: "resolution",
    id: newId("resolution"),
    signature: outcome.signature,
    algorithm: outcome.algorithm,
    base: outcome.base,
    ours: outcome.ours,
    theirs: outcome.theirs,
    resultBlob: outcome.resultBlob,
    resultMode: outcome.resultMode,
    originalPath: outcome.path,
    originatingApplication: application.id,
    originatingCommit: application.appliedCommit,
    originatingChangeId: application.appliedChangeId,
    decision: outcome.decision,
    ref,
    resolutionCommit: commit,
    createdAt: new Date().toISOString(),
  };
  appendNote(commit, record, cwd);
  return { ...record, commit };
}

function currentResolutionOperation(cwd) {
  const operation = readPendingOperation(cwd);
  if (!operation?.current?.conflicts?.length) {
    throw new CliError("No reusable conflict resolutions are pending in this worktree.");
  }
  return operation;
}

function selectConflicts(operation, filePath, all) {
  if (all) return operation.current.conflicts;
  if (filePath) {
    const match = operation.current.conflicts.find(
      (conflict) => conflict.path === filePath,
    );
    if (!match) throw new CliError(`'${filePath}' is not a current conflict path.`);
    return [match];
  }
  if (operation.current.conflicts.length === 1) {
    return [operation.current.conflicts[0]];
  }
  throw new CliError("Choose a conflict path or pass --all.");
}

function chooseCandidate(conflict, resolutionId) {
  if (resolutionId) {
    const match = conflict.candidates.find((candidate) => candidate.id === resolutionId);
    if (!match) {
      throw new CliError(
        `Resolution '${resolutionId}' is not a candidate for '${conflict.path}'.`,
      );
    }
    return match;
  }
  if (conflict.candidates.length === 0) {
    throw new CliError(`No prior resolution matches '${conflict.path}'.`);
  }
  if (conflict.candidates.length > 1) {
    throw new CliError(
      `Multiple resolutions match '${conflict.path}'.`,
      { details: "Choose one with --resolution <id>." },
    );
  }
  return conflict.candidates[0];
}

export function materializeResolutionCandidate(conflict, candidate, cwd) {
  const absolute = path.resolve(cwd, conflict.path);
  if (!candidate.resultBlob) {
    runGit(["rm", "--ignore-unmatch", "--", conflict.path], { cwd });
    return;
  }
  if (!["100644", "100755"].includes(candidate.resultMode)) {
    throw new CliError(
      `Resolution mode '${candidate.resultMode}' is not supported by this prototype.`,
    );
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, readGitBlob(candidate.resultBlob, cwd));
  runGit(["add", "--", conflict.path], { cwd });
  if (candidate.resultMode === "100755") {
    runGit(["update-index", "--chmod=+x", "--", conflict.path], { cwd });
  }
}

export function applyResolution(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = currentResolutionOperation(cwd);
  const selected = selectConflicts(operation, options.path, options.all);
  const choices = selected.map((conflict) => ({
    conflict,
    candidate: chooseCandidate(conflict, options.resolutionId),
  }));
  const applied = [];
  for (const { conflict, candidate } of choices) {
    materializeResolutionCandidate(conflict, candidate, cwd);
    conflict.selectedResolutionId = candidate.id;
    conflict.decisionOverride = null;
    conflict.selectionMethod = "explicit";
    conflict.suggestionAppliedAt = new Date().toISOString();
    applied.push({ path: conflict.path, resolution: candidate });
  }
  writePendingOperation(operation, cwd);
  return { operationId: operation.id, applied };
}

export function rejectResolution(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = currentResolutionOperation(cwd);
  const selected = selectConflicts(operation, options.path, options.all);
  const choices = selected.map((conflict) => ({
    conflict,
    candidate: options.resolutionId
      ? chooseCandidate(conflict, options.resolutionId)
      : null,
  }));
  const rejected = [];
  for (const { conflict, candidate } of choices) {
    if (conflict.candidates.length === 0) {
      throw new CliError(`No prior resolution matches '${conflict.path}'.`);
    }
    conflict.decisionOverride = "rejected";
    conflict.selectedResolutionId = candidate?.id ?? null;
    conflict.selectionMethod = "explicit";
    rejected.push({ path: conflict.path, candidates: conflict.candidates.length });
  }
  writePendingOperation(operation, cwd);
  return { operationId: operation.id, rejected };
}

export function pendingResolutionStatus(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = readPendingOperation(cwd);
  return {
    active: Boolean(operation?.current?.conflicts?.length),
    operationId: operation?.id ?? null,
    conflicts: operation?.current?.conflicts ?? [],
  };
}
