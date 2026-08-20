import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { CliError } from "./errors.js";

const activeMetricCollectors = new Set();
const repositoryContextCache = new Map();

function gitCommandName(args) {
  let commandIndex = 0;
  while (args[commandIndex] === "-c") commandIndex += 2;
  return args[commandIndex] ?? "unknown";
}

export function beginGitMetrics(label = "git") {
  const collector = { label, commands: [] };
  activeMetricCollectors.add(collector);
  return collector;
}

export function endGitMetrics(collector) {
  activeMetricCollectors.delete(collector);
  const byCommand = new Map();
  for (const item of collector.commands) {
    const current = byCommand.get(item.command) ?? {
      command: item.command,
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    current.count += 1;
    current.totalMs += item.durationMs;
    current.maxMs = Math.max(current.maxMs, item.durationMs);
    byCommand.set(item.command, current);
  }
  const totalMs = collector.commands.reduce(
    (total, item) => total + item.durationMs,
    0,
  );
  return {
    count: collector.commands.length,
    totalMs: Number(totalMs.toFixed(2)),
    failed: collector.commands.filter((item) => !item.ok).length,
    byCommand: [...byCommand.values()]
      .map((item) => ({
        ...item,
        totalMs: Number(item.totalMs.toFixed(2)),
        maxMs: Number(item.maxMs.toFixed(2)),
      }))
      .sort((left, right) =>
        right.totalMs - left.totalMs || left.command.localeCompare(right.command),
      ),
  };
}

export function runGit(args, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    input,
    allowFailure = false,
    trim = true,
    binary = false,
  } = options;

  const startedAt = performance.now();
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...env,
    },
    input,
    encoding: binary ? null : "utf8",
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`Could not run git: ${result.error.message}`);
  }

  const durationMs = performance.now() - startedAt;
  const stdout = binary
    ? result.stdout
    : trim
      ? result.stdout.trim()
      : result.stdout;
  const stderr = binary
    ? result.stderr.toString("utf8").trim()
    : result.stderr.trim();
  const output = binary
    ? stderr
    : [stdout, stderr].filter(Boolean).join("\n");

  const command = gitCommandName(args);
  for (const collector of activeMetricCollectors) {
    collector.commands.push({
      command,
      durationMs,
      ok: result.status === 0,
    });
  }

  if (process.env.VLAB_TRACE === "1") {
    process.stderr.write(
      `[vlab trace] ${durationMs.toFixed(1)}ms git ${command}\n`,
    );
  }

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
    durationMs,
  };
}

export function readGitBlob(blob, cwd = process.cwd()) {
  return runGit(["cat-file", "blob", blob], {
    cwd,
    binary: true,
    trim: false,
  }).stdout;
}

export function gitText(args, options = {}) {
  return runGit(args, options).stdout;
}

export function repoContext(cwd = process.cwd()) {
  const cacheKey = path.resolve(cwd);
  const cached = repositoryContextCache.get(cacheKey);
  if (cached) return cached;
  const root = gitText(["rev-parse", "--show-toplevel"], { cwd });
  const gitDirRaw = gitText(["rev-parse", "--git-dir"], { cwd });
  const commonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd });
  const context = {
    root: path.resolve(root),
    gitDir: path.resolve(cwd, gitDirRaw),
    commonDir: path.resolve(cwd, commonDirRaw),
  };
  repositoryContextCache.set(cacheKey, context);
  return context;
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
