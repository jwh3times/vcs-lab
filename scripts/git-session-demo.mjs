import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectRoot, "bin", "vlab.js");
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-lab-git-session-demo-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result;
}

function git(...args) {
  return run("git", args).stdout.trim();
}

function write(content) {
  fs.writeFileSync(path.join(repo, "history.txt"), content);
}

function measure(flag) {
  const started = performance.now();
  const result = run(process.execPath, [
    cli,
    "forecast",
    "feature",
    flag,
    "--trace-git",
    "--json",
  ]);
  const trace = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[vlab trace]"));
  return {
    forecast: JSON.parse(result.stdout),
    wallMs: Number((performance.now() - started).toFixed(2)),
    queries: trace.length,
    processes: trace.filter((line) =>
      /\((?:new|new persistent) process\)$/.test(line),
    ).length,
    sessionQueries: trace.filter((line) =>
      /persistent process\)$/.test(line),
    ).length,
    cacheHits: trace.filter((line) => /\(cache hit\)$/.test(line)).length,
  };
}

console.log(`Creating Git-session comparison at ${repo}\n`);
git("init", "-q", "-b", "main");
git("config", "core.autocrlf", "false");
git("config", "core.eol", "lf");
git("config", "user.name", "VCS Lab Demo");
git("config", "user.email", "vcs-lab@example.test");
write("base\n");
git("add", "history.txt");
git("commit", "-q", "-m", "base");
run(process.execPath, [cli, "init"]);
git("switch", "-q", "-c", "feature");
for (let index = 1; index <= 12; index += 1) {
  write(`${index}\n`);
  git("add", "history.txt");
  git(
    "commit",
    "-q",
    "-m",
    `feature ${index}\n\nChange-Id: ch_demo_${index}`,
  );
}
git("switch", "-q", "main");

const session = measure("--git-session");
const ordinary = measure("--no-git-session");
assert.deepEqual(session.forecast.plan.changes, ordinary.forecast.plan.changes);
assert.equal(
  session.forecast.predictedResultTree,
  ordinary.forecast.predictedResultTree,
);
assert.deepEqual(
  session.forecast.steps.map((step) => [step.outcome, step.resultTree]),
  ordinary.forecast.steps.map((step) => [step.outcome, step.resultTree]),
);
const reduction = ordinary.processes
  ? Number(((1 - session.processes / ordinary.processes) * 100).toFixed(1))
  : 0;

console.log("Equivalent forecasts produced without changing the target.");
console.log(`changes      ${session.forecast.plan.changes.length}`);
console.log(
  `session      ${session.processes} processes; ${session.queries} queries; ${session.wallMs.toFixed(2)} ms`,
);
console.log(
  `ordinary     ${ordinary.processes} processes; ${ordinary.queries} queries; ${ordinary.wallMs.toFixed(2)} ms`,
);
console.log(`process cut  ${reduction.toFixed(1)}%`);
console.log(
  `session I/O  ${session.sessionQueries} persistent queries; ${session.cacheHits} immutable cache hits`,
);
console.log(
  "Windows enables the session automatically. Wall time is machine-specific; plan equality and process reduction are the acceptance invariants.",
);
console.log(`\nInspect the repository with:\n  cd ${repo}\n  vlab forecast feature --trace-git`);
