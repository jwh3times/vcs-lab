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
