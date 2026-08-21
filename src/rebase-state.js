import fs from "node:fs";
import path from "node:path";
import { repoContext } from "./git.js";
import { readJson, writeJson } from "./store.js";

export function rebaseStatePath(cwd = process.cwd()) {
  return path.join(repoContext(cwd).gitDir, "vcs-lab", "rebase.json");
}

export function readRebaseState(cwd = process.cwd()) {
  return readJson(rebaseStatePath(cwd), null);
}

export function writeRebaseState(state, cwd = process.cwd()) {
  const updated = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  writeJson(rebaseStatePath(cwd), updated);
  return updated;
}

export function clearRebaseState(cwd = process.cwd()) {
  fs.rmSync(rebaseStatePath(cwd), { force: true });
}
