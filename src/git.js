import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { CliError } from "./errors.js";

const activeMetricCollectors = new Set();
const repositoryContextCache = new Map();
const activeObjectSessions = new Map();
const SESSION_INFO_BUFFER_BYTES = 1024 * 1024;
const SESSION_CONTENT_BUFFER_BYTES = 64 * 1024 * 1024;
const SESSION_TIMEOUT_MS = 60_000;

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

function recordGitMetric(item) {
  for (const collector of activeMetricCollectors) {
    collector.commands.push(item);
  }
}

function traceGitMetric(item) {
  if (process.env.VLAB_TRACE !== "1") return;
  const detail = item.cacheHit
    ? "cache hit"
    : item.transport === "session"
      ? item.processStarted
        ? "new persistent process"
        : "reused persistent process"
      : "new process";
  process.stderr.write(
    `[vlab trace] ${item.durationMs.toFixed(1)}ms git ${item.command} (${detail})\n`,
  );
}

function invalidateObjectSession(cwd) {
  activeObjectSessions.get(path.resolve(cwd))?.cache.clear();
}

function gitCommandMutates(args, command) {
  const readOnly = new Set([
    "--version",
    "cat-file",
    "cherry",
    "diff",
    "for-each-ref",
    "log",
    "ls-files",
    "merge-base",
    "rev-list",
    "rev-parse",
    "show",
    "show-ref",
    "status",
  ]);
  if (readOnly.has(command)) return false;
  if (command === "notes") {
    return !args.some((item) => ["list", "show"].includes(item));
  }
  if (command === "hash-object") return args.includes("-w");
  return true;
}

export function endGitMetrics(collector) {
  activeMetricCollectors.delete(collector);
  const byCommand = new Map();
  for (const item of collector.commands) {
    const current = byCommand.get(item.command) ?? {
      command: item.command,
      count: 0,
      processes: 0,
      sessionQueries: 0,
      cacheHits: 0,
      totalMs: 0,
      maxMs: 0,
    };
    current.count += 1;
    current.processes += item.processStarted ? 1 : 0;
    current.sessionQueries += item.transport === "session" ? 1 : 0;
    current.cacheHits += item.cacheHit ? 1 : 0;
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
    processes: collector.commands.filter((item) => item.processStarted).length,
    sessionQueries: collector.commands.filter(
      (item) => item.transport === "session",
    ).length,
    cacheHits: collector.commands.filter((item) => item.cacheHit).length,
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
    maxBuffer = 256 * 1024 * 1024,
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
    maxBuffer,
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
  recordGitMetric({
    command,
    durationMs,
    ok: result.status === 0,
    transport: "spawn",
    processStarted: true,
    cacheHit: false,
  });

  traceGitMetric({
    command,
    durationMs,
    transport: "spawn",
    processStarted: true,
    cacheHit: false,
  });

  if (result.status === 0 && gitCommandMutates(args, command)) {
    invalidateObjectSession(cwd);
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

function validateObjectExpressions(expressions) {
  for (const expression of expressions) {
    if (String(expression).includes("\n") || String(expression).includes("\r")) {
      throw new CliError("Git object expressions cannot contain newlines.");
    }
  }
}

function immutableObjectExpression(expression) {
  return /^[0-9a-f]{40,64}(?:\^\{(?:blob|commit|tag|tree)\})?(?::.*)?$/i.test(
    String(expression),
  );
}

class GitObjectSession {
  constructor(cwd) {
    this.cwd = cwd;
    this.cache = new Map();
    this.processCounted = false;
    this.closed = false;
    this.failed = false;
    this.worker = new Worker(new URL("./git-session-worker.js", import.meta.url), {
      workerData: {
        cwd,
        gitCommand:
          process.env.VLAB_TEST_GIT_SESSION_FAILURE === "1"
            ? "vlab-intentionally-missing-git"
            : "git",
      },
    });
    this.worker.unref();
  }

  request(command, expressions) {
    validateObjectExpressions(expressions);
    const cacheKeys = expressions.map((expression) =>
      immutableObjectExpression(expression)
        ? `${command}\0${expression}`
        : null,
    );
    const cached = cacheKeys.map((key) => key ? this.cache.get(key) : undefined);
    if (cached.every(Boolean)) {
      const started = performance.now();
      recordGitMetric({
        command: "object-cache",
        durationMs: performance.now() - started,
        ok: true,
        transport: "cache",
        processStarted: false,
        cacheHit: true,
      });
      traceGitMetric({
        command: "object-cache",
        durationMs: performance.now() - started,
        transport: "cache",
        processStarted: false,
        cacheHit: true,
      });
      return cached;
    }

    const missingIndexes = [];
    const missingExpressions = [];
    cached.forEach((value, index) => {
      if (value) return;
      missingIndexes.push(index);
      missingExpressions.push(expressions[index]);
    });
    const responseBytes = command === "info"
      ? SESSION_INFO_BUFFER_BYTES
      : SESSION_CONTENT_BUFFER_BYTES;
    const shared = new SharedArrayBuffer(16 + responseBytes);
    const header = new Int32Array(shared, 0, 4);
    const started = performance.now();
    this.worker.postMessage({
      type: "query",
      command,
      expressions: missingExpressions,
      shared,
    });
    const wait = Atomics.wait(header, 0, 0, SESSION_TIMEOUT_MS);
    const durationMs = performance.now() - started;
    const processStarted = !this.processCounted;
    this.processCounted = true;
    if (wait === "timed-out") {
      recordGitMetric({
        command: "cat-file-session",
        durationMs,
        ok: false,
        transport: "session",
        processStarted,
        cacheHit: false,
      });
      throw new CliError("Timed out waiting for the Git object session.");
    }
    const length = Atomics.load(header, 1);
    const payload = Buffer.from(new Uint8Array(shared, 16, length)).toString("utf8");
    let response;
    try {
      response = JSON.parse(payload);
    } catch {
      throw new CliError("The Git object session returned malformed data.");
    }
    recordGitMetric({
      command: "cat-file-session",
      durationMs,
      ok: Boolean(response.ok),
      transport: "session",
      processStarted,
      cacheHit: false,
    });
    traceGitMetric({
      command: "cat-file-session",
      durationMs,
      transport: "session",
      processStarted,
      cacheHit: false,
    });
    if (!response.ok) {
      throw new CliError(`Git object session failed: ${response.error}`);
    }
    for (let index = 0; index < response.results.length; index += 1) {
      const resultIndex = missingIndexes[index];
      const raw = response.results[index];
      const value = {
        ...raw,
        content: raw.content === null ? null : Buffer.from(raw.content, "base64"),
      };
      cached[resultIndex] = value;
      if (cacheKeys[resultIndex]) this.cache.set(cacheKeys[resultIndex], value);
    }
    return cached;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const shared = new SharedArrayBuffer(16 + 1024);
    const header = new Int32Array(shared, 0, 4);
    this.worker.postMessage({ type: "close", shared });
    Atomics.wait(header, 0, 0, 5_000);
    this.worker.unref();
  }

  disable() {
    if (this.closed) return;
    this.failed = true;
    this.closed = true;
    this.worker.terminate();
    this.worker.unref();
  }
}

function objectSession(cwd) {
  return activeObjectSessions.get(path.resolve(cwd)) ?? null;
}

function queryObjectSession(cwd, command, expressions) {
  const session = objectSession(cwd);
  if (!session || session.failed) return null;
  try {
    return session.request(command, expressions);
  } catch (error) {
    session.disable();
    if (process.env.VLAB_TRACE === "1") {
      process.stderr.write(
        `[vlab trace] Git object session unavailable; using ordinary processes (${error.message})\n`,
      );
    }
    return null;
  }
}

export function gitObjectSessionEnabled() {
  if (process.env.VLAB_GIT_SESSION === "0") return false;
  if (process.env.VLAB_GIT_SESSION === "1") return true;
  return process.platform === "win32";
}

export function withGitObjectSession(cwd = process.cwd(), callback) {
  if (!gitObjectSessionEnabled()) return callback();
  const key = path.resolve(cwd);
  if (activeObjectSessions.has(key)) return callback();
  const session = new GitObjectSession(key);
  activeObjectSessions.set(key, session);
  try {
    return callback();
  } finally {
    activeObjectSessions.delete(key);
    session.close();
  }
}

export function readGitBlob(blob, cwd = process.cwd()) {
  const sessionResult = queryObjectSession(cwd, "contents", [blob]);
  if (sessionResult) {
    const object = sessionResult[0];
    if (!object.exists || object.type !== "blob") {
      throw new CliError(`Git object '${blob}' is not a blob.`);
    }
    return object.content;
  }
  return runGit(["cat-file", "blob", blob], {
    cwd,
    binary: true,
    trim: false,
  }).stdout;
}

function readBatchLine(buffer, offset) {
  const newline = buffer.indexOf(0x0a, offset);
  if (newline < 0) {
    throw new CliError("Git returned a truncated cat-file batch response.");
  }
  return {
    line: buffer.subarray(offset, newline).toString("utf8"),
    next: newline + 1,
  };
}

/**
 * Read several Git object expressions with one process. Expressions may be
 * object IDs, revision:path pairs, or index expressions such as :path.
 */
export function readGitObjects(expressions, cwd = process.cwd()) {
  if (!Array.isArray(expressions) || expressions.length === 0) return [];
  validateObjectExpressions(expressions);
  const sessionResult = queryObjectSession(cwd, "contents", expressions);
  if (sessionResult) return sessionResult;
  const input = Buffer.from(`${expressions.join("\n")}\n`, "utf8");
  const response = runGit(["cat-file", "--batch"], {
    cwd,
    input,
    binary: true,
    trim: false,
  }).stdout;
  const results = [];
  let offset = 0;
  for (const expression of expressions) {
    const header = readBatchLine(response, offset);
    offset = header.next;
    if (header.line.endsWith(" missing")) {
      results.push({
        expression,
        exists: false,
        oid: null,
        type: null,
        size: 0,
        content: null,
      });
      continue;
    }
    const match = header.line.match(/^([0-9a-f]+) (\S+) (\d+)$/);
    if (!match) {
      throw new CliError(`Unexpected git cat-file batch header: ${header.line}`);
    }
    const size = Number(match[3]);
    const end = offset + size;
    if (end >= response.length || response[end] !== 0x0a) {
      throw new CliError("Git returned a malformed cat-file batch object.");
    }
    results.push({
      expression,
      exists: true,
      oid: match[1],
      type: match[2],
      size,
      content: response.subarray(offset, end),
    });
    offset = end + 1;
  }
  return results;
}

export function gitText(args, options = {}) {
  return runGit(args, options).stdout;
}

export function repoContext(cwd = process.cwd()) {
  const cacheKey = path.resolve(cwd);
  const cached = repositoryContextCache.get(cacheKey);
  if (cached) return cached;
  const [root, gitDirRaw, commonDirRaw, objectFormat] = gitText(
    [
      "rev-parse",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
      "--show-object-format",
    ],
    { cwd },
  ).split(/\r?\n/);
  if (!root || !gitDirRaw || !commonDirRaw || !["sha1", "sha256"].includes(objectFormat)) {
    throw new CliError("Git did not return a complete repository context.");
  }
  const context = {
    root: path.resolve(root),
    gitDir: path.resolve(cwd, gitDirRaw),
    commonDir: path.resolve(cwd, commonDirRaw),
    objectFormat,
  };
  repositoryContextCache.set(cacheKey, context);
  return context;
}

export function resolveRevision(revision, cwd = process.cwd()) {
  const sessionResult = queryObjectSession(cwd, "info", [`${revision}^{commit}`]);
  if (sessionResult) {
    const object = sessionResult[0];
    if (!object.exists || object.type !== "commit") {
      throw new CliError(`Git revision '${revision}' did not resolve to a commit.`);
    }
    return object.oid;
  }
  return gitText(["rev-parse", "--verify", `${revision}^{commit}`], { cwd });
}

export function resolveObjectIds(expressions, cwd = process.cwd()) {
  if (!Array.isArray(expressions) || expressions.length === 0) return [];
  const sessionResult = queryObjectSession(cwd, "info", expressions);
  if (sessionResult) {
    const objects = sessionResult;
    if (objects.some((object) => !object.exists)) {
      throw new CliError("Git did not resolve every requested object expression.");
    }
    return objects.map((object) => object.oid);
  }
  const output = gitText(["rev-parse", ...expressions], { cwd });
  const ids = output.split(/\r?\n/).filter(Boolean);
  if (ids.length !== expressions.length) {
    throw new CliError("Git did not resolve every requested object expression.");
  }
  return ids;
}

export function currentHead(cwd = process.cwd()) {
  return resolveRevision("HEAD", cwd);
}

export function treeId(revision, cwd = process.cwd()) {
  const sessionResult = queryObjectSession(cwd, "info", [`${revision}^{tree}`]);
  if (sessionResult) {
    const object = sessionResult[0];
    if (!object.exists || object.type !== "tree") {
      throw new CliError(`Git revision '${revision}' did not resolve to a tree.`);
    }
    return object.oid;
  }
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
  const sessionResult = queryObjectSession(cwd, "contents", [`${commit}^{commit}`]);
  if (sessionResult) {
    const object = sessionResult[0];
    if (!object.exists || object.type !== "commit") {
      throw new CliError(`Git revision '${commit}' did not resolve to a commit.`);
    }
    const raw = object.content.toString("utf8");
    const separator = raw.indexOf("\n\n");
    return (separator < 0 ? "" : raw.slice(separator + 2)).trim();
  }
  return gitText(["show", "-s", "--format=%B", commit], { cwd });
}

export function commitSubject(commit, cwd = process.cwd()) {
  if (objectSession(cwd)?.failed === false) {
    return commitMessage(commit, cwd).split(/\r?\n/, 1)[0];
  }
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
