import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git.js";
import { repoContext } from "./engine.js";

export function labRuntimeDir(cwd = process.cwd()) {
  const { commonDir } = repoContext(cwd);
  return path.join(commonDir, "vcs-lab");
}

export function ensureLabRuntime(cwd = process.cwd()) {
  const directory = labRuntimeDir(cwd);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function initLab(cwd = process.cwd()) {
  const context = repoContext(cwd);
  ensureLabRuntime(cwd);

  runGit(["config", "notes.displayRef", "refs/notes/vcs-lab"], {
    cwd: context.root,
  });
  runGit(["config", "notes.rewriteRef", "refs/notes/vcs-lab"], {
    cwd: context.root,
  });

  return context;
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}
