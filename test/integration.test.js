import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectRoot, "bin", "vlab.js");

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

function write(repo, relative, content) {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function makeRepo(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-lab-test-"));
  const repo = path.join(parent, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "VCS Lab Test");
  git(repo, "config", "user.email", "vcs-lab@example.test");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { repo, parent };
}

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
  assert.equal(fs.readFileSync(path.join(repo, "continuation.txt"), "utf8"), "three\n");

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
  assert.match(readableReceipts, /same state\s+yes/);
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
