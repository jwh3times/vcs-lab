import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectRoot, "bin", "vlab.js");

test("CLI reports the package version", () => {
  assert.equal(
    exec(process.execPath, [cli, "--version"], projectRoot),
    "vcs-lab 0.3.0",
  );
});

function exec(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...options,
  }).trim();
}

function git(cwd, ...args) {
  return exec("git", args, cwd);
}

function vlab(cwd, ...args) {
  return exec(process.execPath, [cli, ...args], cwd);
}

function vlabResult(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function write(repo, relative, content) {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function readText(repo, relative) {
  return fs
    .readFileSync(path.join(repo, relative), "utf8")
    .replace(/\r\n/g, "\n");
}

function makeRepo(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-lab-test-"));
  const repo = path.join(parent, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "config", "core.eol", "lf");
  git(repo, "config", "user.name", "VCS Lab Test");
  git(repo, "config", "user.email", "vcs-lab@example.test");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { repo, parent };
}

test("init keeps an existing worktree clean", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  vlab(repo, "init");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "reconcile", "--status", "--json")).active,
    false,
  );
});

test("hard squash receipts suppress absorbed changes during reconciliation", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "app.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "feature.txt", "one\n");
  git(repo, "add", ".");
  const first = JSON.parse(vlab(repo, "commit", "-m", "feature one"));
  write(repo, "feature.txt", "one\ntwo\n");
  git(repo, "add", ".");
  const second = JSON.parse(vlab(repo, "commit", "-m", "feature two"));

  git(repo, "switch", "main");
  const landing = JSON.parse(vlab(repo, "hard-squash", "feature", "--json"));
  assert.equal(landing.mode, "hard-squash");
  assert.deepEqual(landing.absorbedChanges, [first.changeId, second.changeId]);

  git(repo, "switch", "feature");
  write(repo, "continuation.txt", "three\n");
  git(repo, "add", ".");
  const third = JSON.parse(vlab(repo, "commit", "-m", "feature three"));
  git(repo, "switch", "main");

  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.covered, 2);
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.changes.find((item) => item.changeId === third.changeId).status, "new");

  const reconciled = JSON.parse(vlab(repo, "reconcile", "feature", "--json"));
  assert.equal(reconciled.receipt.applied.length, 1);
  assert.equal(reconciled.receipt.exactStateEqualityBefore, false);
  assert.equal(reconciled.receipt.exactStateEqualityAfter, true);
  assert.equal(readText(repo, "continuation.txt"), "three\n");

  const after = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(after.counts.new, 0);
  assert.equal(after.counts.covered, 3);

  const graph = vlab(repo, "graph");
  assert.match(graph, /Project history/);
  assert.match(graph, /Causal edges/);
  assert.match(graph, /hard-squash; 2 changes absorbed/);
  assert.doesNotMatch(graph, /Notes added by/);

  const readableReceipts = vlab(repo, "receipts");
  assert.match(readableReceipts, /3 causal records/);
  assert.match(readableReceipts, /LANDING land_/);
  assert.match(readableReceipts, /same after\s+yes/);
  assert.doesNotMatch(readableReceipts, /^\s*\[/);

  const jsonReceipts = JSON.parse(vlab(repo, "receipts", "--json"));
  assert.equal(jsonReceipts.length, 3);
});

test("compact landing is one first-parent unit with a real causal parent", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "feature.txt", "feature\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature");
  const featureHead = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "main");
  const receipt = JSON.parse(vlab(repo, "compact-merge", "feature", "--json"));

  const parents = git(repo, "show", "-s", "--format=%P", "HEAD").split(/\s+/);
  assert.equal(parents.length, 2);
  assert.equal(parents[1], featureHead);
  assert.equal(receipt.mode, "compact");
  assert.doesNotThrow(() => git(repo, "merge-base", "--is-ancestor", "feature", "main"));
});

test("cherry-pick preserves logical identity and fork makes divergence explicit", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "picked.txt", "portable change\n");
  git(repo, "add", ".");
  const origin = JSON.parse(vlab(repo, "commit", "-m", "portable change"));

  git(repo, "switch", "main");
  const application = JSON.parse(vlab(repo, "cherry-pick", origin.changeId, "--json"));
  assert.equal(application.originChangeId, origin.changeId);
  assert.equal(application.appliedChangeId, origin.changeId);
  const duplicate = JSON.parse(vlab(repo, "cherry-pick", origin.changeId, "--json"));
  assert.equal(duplicate.noOp, true);

  git(repo, "switch", "-c", "forked-backport", base.commit);
  const fork = JSON.parse(
    vlab(repo, "cherry-pick", origin.changeId, "--fork", "--json"),
  );
  assert.equal(fork.originChangeId, origin.changeId);
  assert.notEqual(fork.appliedChangeId, origin.changeId);
  assert.equal(fork.relation, "derived-fork");
});

test("workspace checkpoint captures dirty and untracked files without changing them", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  const workspacePath = path.join(parent, "agent-workspace");
  const workspace = JSON.parse(
    vlab(repo, "workspace", "create", "agent-one", "--path", workspacePath, "--json"),
  );
  write(workspacePath, "draft.txt", "unpublished\n");
  const before = git(workspacePath, "status", "--porcelain=v1");
  const checkpoint = JSON.parse(
    vlab(workspacePath, "workspace", "checkpoint", "--label", "agent handoff", "--json"),
  );
  const after = git(workspacePath, "status", "--porcelain=v1");

  assert.equal(workspace.name, "agent-one");
  assert.equal(before, after);
  assert.match(after, /\?\? draft\.txt/);
  const captured = git(workspacePath, "ls-tree", "-r", "--name-only", checkpoint.id);
  assert.match(captured, /draft\.txt/);
});

test("annotated Markdown keeps stable block IDs across edits and moves", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "README.md", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  write(
    repo,
    "docs/spec.md",
    "# Checkout\n\nREQ-CHECKOUT-1: Orders must be idempotent.\n\n## Errors\n\nReturn a typed error.\n",
  );
  const first = JSON.parse(vlab(repo, "spec", "index", "docs/spec.md", "--json"));
  const ids = new Map(first.manifest.blocks.map((block) => [block.semanticKey, block.id]));

  write(
    repo,
    "docs/spec.md",
    "Intro text.\n\n# Checkout\n\nREQ-CHECKOUT-1: Orders must remain idempotent across retries.\n\n## Errors\n\nReturn a typed error.\n",
  );
  const second = JSON.parse(vlab(repo, "spec", "index", "docs/spec.md", "--json"));
  for (const block of second.manifest.blocks) {
    assert.equal(block.id, ids.get(block.semanticKey));
  }
  assert.ok(second.changes.changed.length >= 1);
  assert.ok(second.changes.moved.length >= 1);
});

test("heuristic candidates require explicit acceptance", (t) => {
  const { repo } = makeRepo(t);
  vlab(repo, "init");
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  git(repo, "switch", "-c", "left");
  write(repo, "same.txt", "same\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "left change");
  git(repo, "switch", "main");
  git(repo, "switch", "-c", "right");
  write(repo, "same.txt", "same\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "independent equivalent change");

  const plan = JSON.parse(vlab(repo, "merge-plan", "left", "--json"));
  assert.equal(
    plan.counts["candidate-equivalent"],
    1,
    JSON.stringify(plan, null, 2),
  );
  const attempt = spawnSync(process.execPath, [cli, "reconcile", "left"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /heuristic patch-equivalence candidates/i);
});

test("conflicted reconciliation resumes across processes and records contextual application", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "shared.txt", "feature\n");
  git(repo, "add", "shared.txt");
  const source = JSON.parse(vlab(repo, "commit", "-m", "feature intent"));
  write(repo, "after.txt", "after conflict\n");
  git(repo, "add", "after.txt");
  const afterConflict = JSON.parse(
    vlab(repo, "commit", "-m", "feature follow-up"),
  );

  git(repo, "switch", "main");
  write(repo, "shared.txt", "main\n");
  git(repo, "add", "shared.txt");
  const target = JSON.parse(vlab(repo, "commit", "-m", "main intent"));

  const attempt = vlabResult(repo, "reconcile", "feature");
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /reconciliation paused/i);
  assert.match(attempt.stderr, /vlab reconcile --continue/);

  const status = JSON.parse(vlab(repo, "reconcile", "--status", "--json"));
  assert.equal(status.active, true);
  assert.equal(status.state, "conflicted");
  assert.equal(status.targetBefore, target.commit);
  assert.deepEqual(status.current.unresolvedPaths, ["shared.txt"]);
  assert.deepEqual(JSON.parse(vlab(repo, "receipts", "--json")), []);

  const premature = vlabResult(repo, "reconcile", "--continue");
  assert.notEqual(premature.status, 0);
  assert.match(premature.stderr, /unresolved paths/i);

  write(repo, "shared.txt", "contextual result\n");
  git(repo, "add", "shared.txt");
  const result = JSON.parse(vlab(repo, "reconcile", "--continue", "--json"));
  assert.equal(result.receipt.applied.length, 2);
  assert.equal(result.receipt.applied[0].sourceCommit, source.commit);
  assert.equal(result.receipt.applied[0].relation, "contextual-application");
  assert.deepEqual(result.receipt.applied[0].conflictedPaths, ["shared.txt"]);
  assert.equal(result.receipt.applied[1].sourceCommit, afterConflict.commit);
  assert.equal(result.receipt.applied[1].relation, "causal-reconciliation");
  assert.equal(result.receipt.exactStateEqualityAfter, false);
  assert.equal(readText(repo, "shared.txt"), "contextual result\n");
  assert.equal(readText(repo, "after.txt"), "after conflict\n");

  const idle = JSON.parse(vlab(repo, "reconcile", "--status", "--json"));
  assert.equal(idle.active, false);
  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.new, 0);
  assert.equal(plan.counts.covered, 2);

  const records = JSON.parse(vlab(repo, "receipts", "--json"));
  assert.equal(records.length, 4);
  const contextual = records.find(
    (record) => record.relation === "contextual-application",
  );
  assert.equal(contextual.originChangeId, source.changeId);
  assert.deepEqual(contextual.conflictedPaths, ["shared.txt"]);
  assert.equal(
    records.find((record) => record.type === "resolution").originalPath,
    "shared.txt",
  );
  assert.match(vlab(repo, "graph"), /contextual-application/);
});

test("aborting a mid-queue conflict restores the starting commit without receipts", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "clean.txt", "first change\n");
  git(repo, "add", "clean.txt");
  vlab(repo, "commit", "-m", "clean first change");
  write(repo, "shared.txt", "feature\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "conflicting second change");

  git(repo, "switch", "main");
  write(repo, "shared.txt", "main\n");
  git(repo, "add", "shared.txt");
  const target = JSON.parse(vlab(repo, "commit", "-m", "main conflict"));
  assert.notEqual(target.commit, base.commit);

  const attempt = vlabResult(repo, "reconcile", "feature");
  assert.notEqual(attempt.status, 0);
  const pending = JSON.parse(vlab(repo, "reconcile", "--status", "--json"));
  assert.equal(pending.progress.completed, 1);
  assert.equal(pending.progress.total, 2);
  assert.equal(fs.existsSync(path.join(repo, "clean.txt")), true);

  const aborted = JSON.parse(vlab(repo, "reconcile", "--abort", "--json"));
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.restoredHead, target.commit);
  assert.equal(git(repo, "rev-parse", "HEAD"), target.commit);
  assert.equal(fs.existsSync(path.join(repo, "clean.txt")), false);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.deepEqual(JSON.parse(vlab(repo, "receipts", "--json")), []);
  assert.equal(
    JSON.parse(vlab(repo, "reconcile", "--status", "--json")).active,
    false,
  );
});

test("conflict continuation can explicitly fork logical identity", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  vlab(repo, "branch", "feature");
  write(repo, "shared.txt", "feature\n");
  git(repo, "add", "shared.txt");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source intent"));
  git(repo, "switch", "main");
  write(repo, "shared.txt", "main\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "target intent");

  assert.notEqual(vlabResult(repo, "reconcile", "feature").status, 0);
  write(repo, "shared.txt", "materially different intent\n");
  git(repo, "add", "shared.txt");
  const result = JSON.parse(
    vlab(repo, "reconcile", "--continue", "--fork", "--json"),
  );
  const application = JSON.parse(vlab(repo, "receipts", "--json")).find(
    (record) => record.type === "application",
  );
  assert.equal(application.relation, "contextual-fork");
  assert.equal(application.originChangeId, source.changeId);
  assert.notEqual(application.appliedChangeId, source.changeId);
  assert.match(
    git(repo, "show", "-s", "--format=%B", result.receipt.resultCommit),
    new RegExp(`Derived-From: ${source.changeId}`),
  );

  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.counts.covered, 0);
});

test("pending reconciliations are isolated between linked worktrees", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "a.txt", "base a\n");
  write(repo, "b.txt", "base b\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature-a");
  write(repo, "a.txt", "feature a\n");
  git(repo, "add", "a.txt");
  vlab(repo, "commit", "-m", "feature a");
  git(repo, "switch", "main");
  git(repo, "switch", "-c", "feature-b");
  write(repo, "b.txt", "feature b\n");
  git(repo, "add", "b.txt");
  vlab(repo, "commit", "-m", "feature b");
  git(repo, "switch", "main");
  write(repo, "a.txt", "main a\n");
  write(repo, "b.txt", "main b\n");
  git(repo, "add", ".");
  const target = JSON.parse(vlab(repo, "commit", "-m", "main changes"));

  const pathA = path.join(parent, "workspace-a");
  const pathB = path.join(parent, "workspace-b");
  vlab(repo, "workspace", "create", "agent-a", "--from", "main", "--path", pathA, "--json");
  vlab(repo, "workspace", "create", "agent-b", "--from", "main", "--path", pathB, "--json");

  assert.notEqual(vlabResult(pathA, "reconcile", "feature-a").status, 0);
  assert.notEqual(vlabResult(pathB, "reconcile", "feature-b").status, 0);
  const statusA = JSON.parse(vlab(pathA, "reconcile", "--status", "--json"));
  const statusB = JSON.parse(vlab(pathB, "reconcile", "--status", "--json"));
  assert.notEqual(statusA.operationId, statusB.operationId);
  assert.deepEqual(statusA.current.unresolvedPaths, ["a.txt"]);
  assert.deepEqual(statusB.current.unresolvedPaths, ["b.txt"]);

  write(pathA, "a.txt", "contextual a\n");
  git(pathA, "add", "a.txt");
  const completedA = JSON.parse(
    vlab(pathA, "reconcile", "--continue", "--json"),
  );
  assert.equal(completedA.receipt.applied[0].relation, "contextual-application");
  assert.equal(
    JSON.parse(vlab(pathA, "reconcile", "--status", "--json")).active,
    false,
  );
  assert.equal(
    JSON.parse(vlab(pathB, "reconcile", "--status", "--json")).active,
    true,
  );
  assert.match(vlab(pathB, "receipts"), /contextual-application/);
  assert.equal(JSON.parse(vlab(pathB, "reconcile", "--abort", "--json")).restoredHead, target.commit);
});

test("exact conflict resolutions are suggested and reused across worktrees", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", "shared.txt");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "source-one", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "source one");
  git(repo, "switch", "-c", "target-one", base.commit);
  write(repo, "shared.txt", "target\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "target one");

  assert.notEqual(vlabResult(repo, "reconcile", "source-one").status, 0);
  const firstStatus = JSON.parse(
    vlab(repo, "resolve", "status", "--json"),
  );
  assert.equal(firstStatus.conflicts[0].candidates.length, 0);
  const signature = firstStatus.conflicts[0].signature;
  write(repo, "shared.txt", "remembered resolution\n");
  git(repo, "add", "shared.txt");
  const firstResult = JSON.parse(
    vlab(repo, "reconcile", "--continue", "--json"),
  );
  assert.equal(
    firstResult.receipt.applied[0].resolutions[0].decision,
    "created",
  );
  const catalog = JSON.parse(vlab(repo, "resolve", "list", "--json"));
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].signature, signature);

  git(repo, "switch", "-c", "renamed-base", base.commit);
  git(repo, "mv", "shared.txt", "renamed.txt");
  const renamedBase = JSON.parse(
    vlab(repo, "commit", "-m", "rename shared file"),
  );
  git(repo, "switch", "-c", "source-two", renamedBase.commit);
  write(repo, "renamed.txt", "source\n");
  git(repo, "add", "renamed.txt");
  const sourceTwo = JSON.parse(vlab(repo, "commit", "-m", "source two"));
  git(repo, "switch", "-c", "target-two", renamedBase.commit);
  write(repo, "renamed.txt", "target\n");
  git(repo, "add", "renamed.txt");
  vlab(repo, "commit", "-m", "target two");

  const workspacePath = path.join(parent, "reuse-workspace");
  vlab(
    repo,
    "workspace",
    "create",
    "reuse-agent",
    "--from",
    "target-two",
    "--path",
    workspacePath,
    "--json",
  );
  assert.notEqual(
    vlabResult(workspacePath, "reconcile", "source-two").status,
    0,
  );
  const secondStatus = JSON.parse(
    vlab(workspacePath, "resolve", "status", "--json"),
  );
  assert.equal(secondStatus.conflicts[0].signature, signature);
  assert.equal(secondStatus.conflicts[0].path, "renamed.txt");
  assert.equal(secondStatus.conflicts[0].candidates.length, 1);
  assert.match(readText(workspacePath, "renamed.txt"), /<<<<<<< HEAD/);
  assert.match(vlab(workspacePath, "resolve", "status"), /candidates\s+1/);

  const applied = vlab(workspacePath, "resolve", "apply", "--all");
  assert.match(applied, /Applied 1 resolution suggestion/);
  assert.equal(readText(workspacePath, "renamed.txt"), "remembered resolution\n");
  assert.doesNotMatch(git(workspacePath, "status", "--porcelain=v1"), /^UU/);
  const summary = vlab(workspacePath, "reconcile", "--continue");
  assert.match(summary, /Reconciliation complete/);
  assert.match(summary, /1 accepted/);

  const records = JSON.parse(vlab(workspacePath, "receipts", "--json"));
  const reused = records.find(
    (record) =>
      record.type === "application" &&
      record.originChangeId === sourceTwo.changeId,
  );
  assert.equal(reused.resolutions[0].decision, "accepted");
  assert.equal(reused.resolutions[0].reusedResolutionId, catalog[0].id);
  assert.equal(
    JSON.parse(vlab(workspacePath, "resolve", "list", "--json")).length,
    1,
  );
  const graph = vlab(workspacePath, "graph");
  assert.match(graph, /contextual-application.*reconciliation 1 covered/);
  assert.doesNotMatch(graph, /reconcile; 1 covered/);
});

test("modified and rejected suggestions create auditable resolution variants", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", "shared.txt");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  const createPair = (suffix) => {
    const source = `source-${suffix}`;
    const target = `target-${suffix}`;
    git(repo, "switch", "-c", source, base.commit);
    write(repo, "shared.txt", "source\n");
    git(repo, "add", "shared.txt");
    const sourceCommit = JSON.parse(
      vlab(repo, "commit", "-m", `source ${suffix}`),
    );
    git(repo, "switch", "-c", target, base.commit);
    write(repo, "shared.txt", "target\n");
    git(repo, "add", "shared.txt");
    vlab(repo, "commit", "-m", `target ${suffix}`);
    return { source, sourceCommit };
  };

  const first = createPair("first");
  assert.notEqual(vlabResult(repo, "reconcile", first.source).status, 0);
  write(repo, "shared.txt", "resolution one\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "reconcile", "--continue", "--json");

  const second = createPair("second");
  assert.notEqual(vlabResult(repo, "reconcile", second.source).status, 0);
  vlab(repo, "resolve", "apply", "--all");
  write(repo, "shared.txt", "resolution two\n");
  git(repo, "add", "shared.txt");
  const modified = JSON.parse(
    vlab(repo, "reconcile", "--continue", "--json"),
  );
  assert.equal(modified.receipt.applied[0].resolutions[0].decision, "modified");
  assert.equal(JSON.parse(vlab(repo, "resolve", "list", "--json")).length, 2);

  const third = createPair("third");
  assert.notEqual(vlabResult(repo, "reconcile", third.source).status, 0);
  const ambiguous = vlabResult(repo, "resolve", "apply", "--all");
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /multiple resolutions match/i);
  assert.match(vlab(repo, "resolve", "reject", "--all"), /Rejected 1/);
  write(repo, "shared.txt", "resolution three\n");
  git(repo, "add", "shared.txt");
  const rejected = JSON.parse(
    vlab(repo, "reconcile", "--continue", "--json"),
  );
  assert.equal(rejected.receipt.applied[0].resolutions[0].decision, "rejected");
  assert.equal(JSON.parse(vlab(repo, "resolve", "list", "--json")).length, 3);
});

test("doctor benchmarks Git probes and trace mode reports subprocess timings", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-m", "base");
  const doctor = JSON.parse(vlab(repo, "doctor", "--benchmark"));
  assert.equal(doctor.ok, true);
  assert.equal(doctor.benchmark.length, 4);
  assert.ok(doctor.benchmark.every((probe) => probe.samplesMs.length === 3));

  const traced = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", VLAB_TRACE: "1" },
  });
  assert.equal(traced.status, 0);
  assert.match(traced.stderr, /\[vlab trace\].*git --version/);
});
