import fs from "node:fs";
import path from "node:path";
import { repoContext, runGit } from "./git.js";
import { readJson, writeJson } from "./store.js";

export function reconciliationStatePath(cwd = process.cwd()) {
  const { gitDir } = repoContext(cwd);
  return path.join(gitDir, "vcs-lab", "reconciliation.json");
}

export function readReconciliationState(cwd = process.cwd()) {
  return readJson(reconciliationStatePath(cwd), null);
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

export function unmergedPaths(cwd = process.cwd()) {
  const result = runGit(["diff", "--name-only", "--diff-filter=U"], {
    cwd,
    allowFailure: true,
  });
  return result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

export function cherryPickHead(cwd = process.cwd()) {
  const result = runGit(["rev-parse", "--verify", "-q", "CHERRY_PICK_HEAD"], {
    cwd,
    allowFailure: true,
  });
  return result.ok ? result.stdout : null;
}

export function mergeMessagePath(cwd = process.cwd()) {
  const raw = runGit(["rev-parse", "--git-path", "MERGE_MSG"], { cwd }).stdout;
  return path.resolve(cwd, raw);
}
