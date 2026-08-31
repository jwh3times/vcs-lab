import fs from "node:fs";
import path from "node:path";
import { repoContext } from "./engine.js";

export { unmergedPaths } from "./engine.js";
import { readJson, writeJson } from "./store.js";
import { assertReadableSchema } from "./schemas.js";

export function reconciliationStatePath(cwd = process.cwd()) {
  const { gitDir } = repoContext(cwd);
  return path.join(gitDir, "vcs-lab", "reconciliation.json");
}

/**
 * Read this worktree's reconciliation journal. A journal whose schema this
 * build does not read is refused rather than resumed (ADR-0020): the queue,
 * cursor, and recovery fields of a version we do not understand cannot be
 * interpreted safely, and resuming or aborting from them could move refs the
 * writer never intended.
 */
export function readReconciliationState(cwd = process.cwd()) {
  const statePath = reconciliationStatePath(cwd);
  const state = readJson(statePath, null);
  if (state === null) return null;
  assertReadableSchema(state?.schema, `The reconciliation journal at '${statePath}'`, {
    family: "vcs-lab.reconciliation-operation",
    recovery:
      "Recover it with the vcs-lab build that wrote it, or remove the file to discard the operation.",
  });
  return state;
}

export function writeReconciliationState(state, cwd = process.cwd()) {
  const updated = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  writeJson(reconciliationStatePath(cwd), updated);
  return updated;
}

export function clearReconciliationState(cwd = process.cwd()) {
  fs.rmSync(reconciliationStatePath(cwd), { force: true });
}

export function cherryPickHead(cwd = process.cwd()) {
  try {
    const value = fs.readFileSync(
      path.join(repoContext(cwd).gitDir, "CHERRY_PICK_HEAD"),
      "utf8",
    ).trim();
    return /^[0-9a-f]+$/i.test(value) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function mergeMessagePath(cwd = process.cwd()) {
  return path.join(repoContext(cwd).gitDir, "MERGE_MSG");
}
