import { spawnSync } from "node:child_process";
import path from "node:path";
import { CliError } from "./errors.js";

export function runGit(args, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    input,
    allowFailure = false,
    trim = true,
  } = options;

  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...env,
    },
    input,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`Could not run git: ${result.error.message}`);
  }

  const stdout = trim ? result.stdout.trim() : result.stdout;
  const stderr = result.stderr.trim();
  const output = [stdout, stderr].filter(Boolean).join("\n");

  if (result.status !== 0 && !allowFailure) {
    throw new CliError(`git ${args.join(" ")} failed`, {
      details: output,
      exitCode: result.status || 1,
    });
  }

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout,
    stderr,
    output,
  };
}

export function gitText(args, options = {}) {
  return runGit(args, options).stdout;
}

export function repoContext(cwd = process.cwd()) {
  const root = gitText(["rev-parse", "--show-toplevel"], { cwd });
  const gitDirRaw = gitText(["rev-parse", "--git-dir"], { cwd });
  const commonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd });
  return {
    root: path.resolve(root),
    gitDir: path.resolve(cwd, gitDirRaw),
    commonDir: path.resolve(cwd, commonDirRaw),
  };
}

export function resolveRevision(revision, cwd = process.cwd()) {
  return gitText(["rev-parse", "--verify", `${revision}^{commit}`], { cwd });
}

export function currentHead(cwd = process.cwd()) {
  return resolveRevision("HEAD", cwd);
}

export function treeId(revision, cwd = process.cwd()) {
  return gitText(["rev-parse", `${revision}^{tree}`], { cwd });
}

export function mergeBase(left, right, cwd = process.cwd()) {
  return gitText(["merge-base", left, right], { cwd });
}

export function listCommits(base, tip, cwd = process.cwd()) {
  const result = gitText(["rev-list", "--reverse", `${base}..${tip}`], { cwd });
  return result ? result.split(/\r?\n/).filter(Boolean) : [];
}

export function commitMessage(commit, cwd = process.cwd()) {
  return gitText(["show", "-s", "--format=%B", commit], { cwd });
}

export function commitSubject(commit, cwd = process.cwd()) {
  return gitText(["show", "-s", "--format=%s", commit], { cwd });
}

export function extractTrailer(message, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = message.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() ?? null;
}

export function changeIdForCommit(commit, cwd = process.cwd()) {
  return extractTrailer(commitMessage(commit, cwd), "Change-Id") ?? `git:${commit}`;
}

export function isAncestor(ancestor, descendant, cwd = process.cwd()) {
  return runGit(["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    allowFailure: true,
  }).ok;
}

export function refExists(ref, cwd = process.cwd()) {
  return runGit(["show-ref", "--verify", "--quiet", ref], {
    cwd,
    allowFailure: true,
  }).ok;
}

export function assertClean(cwd = process.cwd()) {
  const status = gitText(["status", "--porcelain=v1"], { cwd });
  if (status) {
    throw new CliError("The worktree must be clean for this operation.", {
      details: status,
    });
  }
}

export function findCommitByChangeId(changeId, cwd = process.cwd()) {
  const output = gitText(
    ["log", "--all", "--format=%H%x1f%B%x1e"],
    { cwd, trim: false },
  );
  for (const record of output.split("\x1e")) {
    if (!record.trim()) continue;
    const separator = record.indexOf("\x1f");
    if (separator < 0) continue;
    const commit = record.slice(0, separator).trim();
    const message = record.slice(separator + 1);
    if (extractTrailer(message, "Change-Id") === changeId) {
      return commit;
    }
  }
  return null;
}
