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
    "vcs-lab 0.8.0",
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

function createIndexedSpecDivergence(repo, options = {}) {
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nbase alpha\n\n# Beta\n\nbase beta\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md", "--json");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base specification"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nsource alpha\n\n# Beta\n\nbase beta\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md", "--json");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source edits alpha"));

  git(repo, "switch", "main");
  write(
    repo,
    "docs/spec.md",
    options.sameBlock
      ? "# Alpha\n\ntarget alpha\n\n# Beta\n\nbase beta\n"
      : "# Alpha\n\nbase alpha\n\n# Beta\n\ntarget beta\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md", "--json");
  git(repo, "add", ".");
  const target = JSON.parse(vlab(repo, "commit", "-m", "target edits specification"));
  return { base, source, target };
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

test("causal rebase planning is deterministic and replays only hard-squash continuation", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "one\n");
  git(repo, "add", ".");
  const first = JSON.parse(vlab(repo, "commit", "-m", "feature one"));
  write(repo, "feature.txt", "one\ntwo\n");
  git(repo, "add", ".");
  const second = JSON.parse(vlab(repo, "commit", "-m", "feature two"));

  git(repo, "switch", "main");
  vlab(repo, "hard-squash", "feature", "--json");
  git(repo, "switch", "feature");
  write(repo, "continuation.txt", "three\n");
  git(repo, "add", ".");
  const continuation = JSON.parse(
    vlab(repo, "commit", "-m", "feature continuation"),
  );
  write(repo, "caller-draft.txt", "uncommitted caller bytes\n");

  const callerBefore = {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    tree: git(repo, "rev-parse", "HEAD^{tree}"),
    status: git(repo, "status", "--porcelain=v1"),
    notes: git(repo, "rev-parse", "refs/notes/vcs-lab"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  assert.match(callerBefore.status, /\?\? caller-draft\.txt/);
  const plan = JSON.parse(vlab(repo, "rebase-plan", "main", "--json"));
  const repeated = JSON.parse(vlab(repo, "rebase-plan", "main", "--json"));

  assert.equal(plan.schema, "vcs-lab.rebase-plan/v1");
  assert.equal(plan.mode, "linear");
  assert.equal(plan.ontoRef, "main");
  assert.equal(plan.sourceRef, "feature");
  assert.equal(plan.sourceHead, continuation.commit);
  assert.deepEqual(plan.counts, {
    covered: 2,
    "candidate-equivalent": 0,
    new: 1,
  });
  assert.deepEqual(
    plan.omitted.map((item) => item.changeId),
    [first.changeId, second.changeId],
  );
  assert.ok(
    plan.omitted.every((item) =>
      ["signed-shaped-landing-receipt", "receipt-change-id"].includes(item.proof),
    ),
  );
  assert.deepEqual(
    plan.replayQueue.map((item) => item.changeId),
    [continuation.changeId],
  );
  assert.equal(plan.constraints.supported, true);
  assert.equal(plan.candidateDecisionRequired, false);
  assert.equal(plan.executableWithoutReview, true);
  assert.match(plan.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(repeated, plan);
  assert.match(vlab(repo, "rebase-plan", "main"), /1 replay/);

  const callerAfter = {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    tree: git(repo, "rev-parse", "HEAD^{tree}"),
    status: git(repo, "status", "--porcelain=v1"),
    notes: git(repo, "rev-parse", "refs/notes/vcs-lab"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  assert.deepEqual(callerAfter, callerBefore);
});

test("causal rebase planning keeps heuristic candidates in review", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "equivalent.txt", "same patch\n");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source patch"));

  git(repo, "switch", "main");
  write(repo, "equivalent.txt", "same patch\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "independent target patch");

  const plan = JSON.parse(
    vlab(repo, "rebase-plan", "main", "feature", "--json"),
  );
  assert.equal(plan.counts["candidate-equivalent"], 1);
  assert.deepEqual(plan.replayQueue, []);
  assert.equal(plan.candidates[0].changeId, source.changeId);
  assert.equal(plan.candidates[0].proof, "git-patch-id-heuristic");
  assert.equal(plan.changes[0].action, "review");
  assert.equal(plan.candidateDecisionRequired, true);
  assert.equal(plan.executableWithoutReview, false);
  assert.equal(git(repo, "branch", "--show-current"), "main");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("causal rebase planning marks merge topology unsupported in linear v1", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "feature\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature work");

  git(repo, "switch", "-c", "side", base.commit);
  write(repo, "side.txt", "side\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "side work");
  git(repo, "switch", "feature");
  git(repo, "merge", "--no-ff", "side", "-m", "merge side");
  const mergeCommit = git(repo, "rev-parse", "HEAD");

  git(repo, "switch", "main");
  const plan = JSON.parse(
    vlab(repo, "rebase-plan", "main", "feature", "--json"),
  );
  assert.equal(plan.constraints.supported, false);
  assert.equal(plan.constraints.linearHistory, false);
  assert.deepEqual(plan.constraints.mergeCommits, [mergeCommit]);
  assert.equal(plan.executableWithoutReview, false);
  assert.match(vlab(repo, "rebase-plan", "main", "feature"), /unsupported/i);
  const worktreesBefore = git(repo, "worktree", "list", "--porcelain");
  const forecast = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "feature", "--json"),
  );
  assert.equal(forecast.status, "unsupported");
  assert.equal(forecast.blockedReason, "merge-topology-unsupported");
  assert.equal(forecast.predictedResultTree, null);
  assert.deepEqual(forecast.steps, []);
  assert.equal(forecast.remainingChanges, forecast.plan.replayQueue.length);
  assert.match(
    vlab(repo, "rebase-forecast", "main", "feature"),
    /Linear v1 cannot forecast source history containing merge commits/,
  );
  assert.equal(git(repo, "worktree", "list", "--porcelain"), worktreesBefore);
  assert.equal(git(repo, "branch", "--show-current"), "main");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("causal rebase forecasts are deterministic and preserve a dirty caller", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "one\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature one");
  write(repo, "feature.txt", "one\ntwo\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature two");

  git(repo, "switch", "main");
  vlab(repo, "hard-squash", "feature", "--json");
  git(repo, "switch", "feature");
  write(repo, "continuation.txt", "three\n");
  git(repo, "add", ".");
  const continuation = JSON.parse(
    vlab(repo, "commit", "-m", "feature continuation"),
  );
  git(repo, "mv", "base.txt", "caller-base-draft.txt");
  write(repo, "caller-draft.txt", "uncommitted caller bytes\n");

  const callerBefore = {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    status: git(repo, "status", "--porcelain=v1"),
    renamedBase: readText(repo, "caller-base-draft.txt"),
    draft: readText(repo, "caller-draft.txt"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  const first = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "--json"),
  );
  const repeated = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "--json"),
  );

  assert.equal(first.schema, "vcs-lab.rebase-forecast/v1");
  assert.equal(first.status, "complete");
  assert.equal(first.sourceRef, "feature");
  assert.equal(first.scope, "committed-heads");
  assert.equal(first.ignoredCallerDirtyFiles, 2);
  assert.equal(first.candidatePolicy, "none");
  assert.equal(first.callerInvariants.preserved, true);
  assert.equal(first.planFingerprint, first.plan.fingerprint);
  assert.deepEqual(
    first.plan.replayQueue.map((item) => item.changeId),
    [continuation.changeId],
  );
  assert.equal(first.steps.length, 1);
  assert.equal(first.steps[0].relation, "causal-rebase");
  assert.equal(first.steps[0].targetBeforeTree, first.ontoTree);
  assert.equal(first.steps[0].resultTree, first.sourceTree);
  assert.equal(first.predictedResultTree, first.sourceTree);
  assert.equal(first.exactStateEqualityAfter, true);
  assert.notEqual(first.id, repeated.id);
  assert.equal(first.planFingerprint, repeated.planFingerprint);
  assert.deepEqual(first.steps, repeated.steps);
  assert.equal(first.predictedResultTree, repeated.predictedResultTree);
  assert.match(vlab(repo, "rebase-forecast", "main"), /status\s+complete/);

  const metadata = JSON.parse(vlab(repo, "metadata", "status", "--json"));
  assert.equal(metadata.scopes.worktreePrivate.forecastCount, 3);
  const callerAfter = {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    status: git(repo, "status", "--porcelain=v1"),
    renamedBase: readText(repo, "caller-base-draft.txt"),
    draft: readText(repo, "caller-draft.txt"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  assert.deepEqual(callerAfter, callerBefore);
});

test("causal rebase forecasts require and pin candidate acceptance", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "equivalent.txt", "same patch\n");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source patch"));

  git(repo, "switch", "main");
  write(repo, "equivalent.txt", "same patch\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "independent target patch");
  const callerBefore = {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    status: git(repo, "status", "--porcelain=v1"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };

  const review = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "feature", "--json"),
  );
  assert.equal(review.status, "review-required");
  assert.equal(review.candidateDecisionRequired, true);
  assert.equal(review.candidatePolicy, "review-required");
  assert.equal(review.blockedReason, "heuristic-candidate-decision-required");
  assert.equal(review.predictedResultTree, null);
  assert.deepEqual(review.acceptedCandidates, []);

  const accepted = JSON.parse(
    vlab(
      repo,
      "rebase-forecast",
      "main",
      "feature",
      "--accept-candidates",
      "--json",
    ),
  );
  assert.equal(accepted.status, "complete");
  assert.equal(accepted.candidateDecisionRequired, false);
  assert.equal(accepted.candidatePolicy, "accepted");
  assert.equal(accepted.acceptedCandidates.length, 1);
  assert.equal(accepted.acceptedCandidates[0].changeId, source.changeId);
  assert.equal(accepted.acceptedCandidates[0].decision, "omit");
  assert.equal(accepted.steps.length, 0);
  assert.equal(accepted.predictedResultTree, accepted.ontoTree);
  assert.equal(accepted.exactStateEqualityAfter, true);
  assert.equal(accepted.planFingerprint, review.planFingerprint);
  assert.deepEqual(
    {
      head: git(repo, "rev-parse", "HEAD"),
      branch: git(repo, "branch", "--show-current"),
      status: git(repo, "status", "--porcelain=v1"),
      worktrees: git(repo, "worktree", "list", "--porcelain"),
    },
    callerBefore,
  );
});

test("causal rebase forecasts expose conflicts without mutating the caller", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "source changes shared file");

  git(repo, "switch", "main");
  write(repo, "shared.txt", "target\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "target changes shared file");
  const callerBefore = {
    head: git(repo, "rev-parse", "HEAD"),
    status: git(repo, "status", "--porcelain=v1"),
    content: readText(repo, "shared.txt"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };

  const forecast = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "feature", "--json"),
  );
  assert.equal(forecast.status, "blocked");
  assert.equal(forecast.blockedReason, "missing-exact-resolution");
  assert.equal(forecast.predictedResultTree, null);
  assert.equal(forecast.steps.length, 1);
  assert.equal(forecast.steps[0].outcome, "blocked-conflict");
  assert.equal(forecast.steps[0].targetBeforeTree, forecast.ontoTree);
  assert.deepEqual(
    forecast.steps[0].conflicts.map((item) => item.path),
    ["shared.txt"],
  );
  assert.equal(forecast.steps[0].conflicts[0].candidates.length, 0);
  assert.deepEqual(
    {
      head: git(repo, "rev-parse", "HEAD"),
      status: git(repo, "status", "--porcelain=v1"),
      content: readText(repo, "shared.txt"),
      worktrees: git(repo, "worktree", "list", "--porcelain"),
    },
    callerBefore,
  );
});

test("causal rebase applies a reviewed continuation and ports unreachable origins", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "one\n");
  git(repo, "add", ".");
  const first = JSON.parse(vlab(repo, "commit", "-m", "feature one"));
  write(repo, "feature.txt", "one\ntwo\n");
  git(repo, "add", ".");
  const second = JSON.parse(vlab(repo, "commit", "-m", "feature two"));

  git(repo, "switch", "main");
  const landing = JSON.parse(vlab(repo, "hard-squash", "feature", "--json"));
  git(repo, "switch", "feature");
  write(repo, "continuation.txt", "three\n");
  git(repo, "add", ".");
  const continuation = JSON.parse(
    vlab(repo, "commit", "-m", "feature continuation"),
  );
  const originalTree = git(repo, "rev-parse", "HEAD^{tree}");

  const forecast = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "--json"),
  );
  const result = JSON.parse(
    vlab(
      repo,
      "rebase",
      "main",
      "--use-forecast",
      forecast.id,
      "--json",
    ),
  );
  assert.equal(result.receipt.schema, "vcs-lab.rebase/v1");
  assert.equal(result.receipt.forecastId, forecast.id);
  assert.equal(result.receipt.sourceHead, continuation.commit);
  assert.equal(result.receipt.resultTree, forecast.predictedResultTree);
  assert.equal(result.receipt.resultTree, originalTree);
  assert.equal(result.receipt.exactStateEqualityAfter, true);
  assert.deepEqual(result.receipt.absorbedChanges, [
    first.changeId,
    second.changeId,
    continuation.changeId,
  ]);
  assert.equal(result.receipt.applications.length, 1);
  assert.equal(
    result.receipt.applications[0].sourceChangeId,
    continuation.changeId,
  );
  assert.equal(
    result.receipt.applications[0].appliedChangeId,
    continuation.changeId,
  );
  assert.equal(git(repo, "branch", "--show-current"), "feature");
  assert.equal(git(repo, "show", "-s", "--format=%P", "HEAD"), landing.landingCommit);
  assert.doesNotThrow(() =>
    git(repo, "merge-base", "--is-ancestor", "main", "feature"),
  );
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "rebase", "--status", "--json")).active,
    false,
  );
  const validation = JSON.parse(vlab(repo, "metadata", "validate", "--json"));
  assert.equal(validation.summary.valid, true);
  assert.equal(validation.summary.acceptedPortableRecords, 3);
  assert.match(vlab(repo, "receipts"), /REBASE rebase_/);
  assert.match(vlab(repo, "graph"), /rebase onto/);

  const envelopeA = path.join(parent, "rebase-envelope-a");
  const envelopeB = path.join(parent, "rebase-envelope-b");
  vlab(repo, "metadata", "export", envelopeA, "--json");
  vlab(repo, "metadata", "export", envelopeB, "--json");
  assert.deepEqual(
    fs.readFileSync(path.join(envelopeA, "manifest.json")),
    fs.readFileSync(path.join(envelopeB, "manifest.json")),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(envelopeA, "objects.bundle")),
    fs.readFileSync(path.join(envelopeB, "objects.bundle")),
  );

  const destination = path.join(parent, "rebase-destination");
  git(parent, "clone", "--no-local", repo, destination);
  git(destination, "config", "user.name", "VCS Lab Test");
  git(destination, "config", "user.email", "vcs-lab@example.test");
  const missingOrigin = spawnSync(
    "git",
    ["cat-file", "-e", `${continuation.commit}^{commit}`],
    { cwd: destination, encoding: "utf8" },
  );
  assert.notEqual(missingOrigin.status, 0);
  const preview = JSON.parse(
    vlab(destination, "metadata", "import", envelopeA, "--dry-run", "--json"),
  );
  assert.equal(preview.summary.applicable, true);
  assert.equal(preview.summary.addRecords, 3);
  vlab(destination, "metadata", "import", envelopeA, "--apply", "--json");
  assert.doesNotThrow(() =>
    git(destination, "cat-file", "-e", `${continuation.commit}^{commit}`),
  );
  const importedValidation = JSON.parse(
    vlab(destination, "metadata", "validate", "--json"),
  );
  assert.equal(importedValidation.summary.valid, true);
  assert.equal(importedValidation.summary.acceptedPortableRecords, 3);
});

test("causal rebase rejects a stale forecast before moving the source branch", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "feature\n");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "feature"));
  const forecast = JSON.parse(
    vlab(repo, "rebase-forecast", "main", "--json"),
  );

  git(repo, "switch", "main");
  write(repo, "target.txt", "target moved\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "move target");
  git(repo, "switch", "feature");
  const attempt = vlabResult(
    repo,
    "rebase",
    "main",
    "--use-forecast",
    forecast.id,
  );
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /forecast .* is stale/i);
  assert.equal(git(repo, "rev-parse", "HEAD"), source.commit);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "rebase", "--status", "--json")).active,
    false,
  );
});

test("causal rebase pauses privately and can continue as an explicit fork", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source change"));
  git(repo, "switch", "main");
  write(repo, "shared.txt", "target\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "target change");
  git(repo, "switch", "feature");

  const observer = path.join(parent, "rebase-observer");
  git(repo, "worktree", "add", observer, "main");
  const attempt = vlabResult(repo, "rebase", "main");
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /causal rebase paused/i);
  const status = JSON.parse(vlab(repo, "rebase", "--status", "--json"));
  assert.equal(status.active, true);
  assert.equal(status.state, "conflicted");
  assert.equal(status.progress.completed, 0);
  assert.deepEqual(status.current.unresolvedPaths, ["shared.txt"]);
  assert.equal(
    JSON.parse(vlab(observer, "rebase", "--status", "--json")).active,
    false,
  );
  const metadata = JSON.parse(vlab(repo, "metadata", "status", "--json"));
  assert.equal(metadata.scopes.worktreePrivate.pendingOperationCount, 1);
  const privateEntry = metadata.scopes.worktreePrivate.worktrees.find(
    (entry) => entry.path === path.resolve(repo),
  );
  assert.deepEqual(privateEntry.pendingOperationKinds, ["rebase"]);
  assert.equal(
    JSON.parse(vlab(repo, "resolve", "status", "--json")).conflicts.length,
    1,
  );

  write(repo, "shared.txt", "forked resolution\n");
  git(repo, "add", "shared.txt");
  const completed = JSON.parse(
    vlab(repo, "rebase", "--continue", "--fork", "--json"),
  );
  const application = completed.receipt.applications[0];
  assert.equal(application.relation, "contextual-fork");
  assert.equal(application.sourceChangeId, source.changeId);
  assert.notEqual(application.appliedChangeId, source.changeId);
  assert.deepEqual(completed.receipt.forkedSourceCommits, [source.commit]);
  assert.deepEqual(completed.receipt.absorbedCommits, []);
  assert.match(git(repo, "show", "-s", "--format=%B", "HEAD"), /Derived-From:/);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "metadata", "validate", "--json")).summary.valid,
    true,
  );
});

test("causal rebase abort restores the exact source after a partial replay", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "clean.txt", "clean replay\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "clean first change");
  write(repo, "shared.txt", "source\n");
  git(repo, "add", ".");
  const original = JSON.parse(vlab(repo, "commit", "-m", "conflicting second change"));
  const originalTree = git(repo, "rev-parse", "HEAD^{tree}");

  git(repo, "switch", "main");
  write(repo, "shared.txt", "target\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "target change");
  git(repo, "switch", "feature");
  const notesBefore = git(
    repo,
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/notes/vcs-lab",
  );

  const attempt = vlabResult(repo, "rebase", "main");
  assert.notEqual(attempt.status, 0);
  const paused = JSON.parse(vlab(repo, "rebase", "--status", "--json"));
  assert.equal(paused.state, "conflicted");
  assert.equal(paused.progress.completed, 1);
  assert.equal(paused.applied.length, 1);
  assert.equal(
    git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/notes/vcs-lab"),
    notesBefore,
  );

  const aborted = JSON.parse(vlab(repo, "rebase", "--abort", "--json"));
  assert.equal(aborted.restoredHead, original.commit);
  assert.equal(git(repo, "rev-parse", "HEAD"), original.commit);
  assert.equal(git(repo, "rev-parse", "HEAD^{tree}"), originalTree);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "rebase", "--status", "--json")).active,
    false,
  );
  assert.equal(
    git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/notes/vcs-lab"),
    notesBefore,
  );
});

test("causal rebase blocks an unexpectedly empty replay instead of skipping it", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  const empty = JSON.parse(
    vlab(repo, "commit", "-m", "intentional empty change", "--allow-empty"),
  );
  const plan = JSON.parse(vlab(repo, "rebase-plan", "main", "--json"));
  assert.equal(plan.replayQueue.length, 1);
  assert.equal(plan.replayQueue[0].commit, empty.commit);

  const attempt = vlabResult(repo, "rebase", "main");
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /unexpectedly empty|blocked/i);
  const status = JSON.parse(vlab(repo, "rebase", "--status", "--json"));
  assert.equal(status.active, true);
  assert.equal(status.state, "blocked");
  assert.equal(status.progress.completed, 0);
  assert.equal(
    git(repo, "for-each-ref", "--format=%(refname)", "refs/notes/vcs-lab"),
    "",
  );
  const aborted = JSON.parse(vlab(repo, "rebase", "--abort", "--json"));
  assert.equal(aborted.restoredHead, empty.commit);
  assert.equal(git(repo, "rev-parse", "HEAD"), empty.commit);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("causal rebase batch-applies a pinned exact resolution", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "source-one", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "source one");
  git(repo, "switch", "-c", "target-one", base.commit);
  write(repo, "shared.txt", "target\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "target one");
  assert.notEqual(vlabResult(repo, "reconcile", "source-one").status, 0);
  write(repo, "shared.txt", "remembered\n");
  git(repo, "add", ".");
  vlab(repo, "reconcile", "--continue", "--json");

  git(repo, "switch", "-c", "source-two", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "source two"));
  git(repo, "switch", "-c", "target-two", base.commit);
  write(repo, "shared.txt", "target\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "target two");
  git(repo, "switch", "source-two");

  const forecast = JSON.parse(
    vlab(repo, "rebase-forecast", "target-two", "--json"),
  );
  assert.equal(forecast.status, "complete");
  assert.equal(forecast.steps[0].outcome, "exact-resolution");
  assert.equal(forecast.approvedResolutions.length, 1);
  const result = JSON.parse(
    vlab(
      repo,
      "rebase",
      "target-two",
      "--use-forecast",
      forecast.id,
      "--json",
    ),
  );
  assert.equal(result.receipt.forecastId, forecast.id);
  assert.equal(result.receipt.resultTree, forecast.predictedResultTree);
  assert.equal(result.receipt.applications[0].relation, "contextual-rebase");
  assert.equal(result.receipt.applications[0].sourceChangeId, source.changeId);
  assert.equal(result.receipt.applications[0].appliedChangeId, source.changeId);
  assert.equal(
    result.receipt.applications[0].resolutions[0].selectionMethod,
    "rebase-forecast-batch",
  );
  assert.equal(
    result.receipt.applications[0].resolutions[0].decision,
    "accepted",
  );
  assert.equal(readText(repo, "shared.txt"), "remembered\n");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
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

test("workspace lifecycle preserves identity and checkpoints across move, archive, repair, and prune", (t) => {
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
  const firstCheckpointRef = git(repo, "rev-parse", checkpoint.ref);

  assert.equal(workspace.name, "agent-one");
  assert.equal(before, after);
  assert.match(after, /\?\? draft\.txt/);
  const captured = git(workspacePath, "ls-tree", "-r", "--name-only", checkpoint.id);
  assert.match(captured, /draft\.txt/);
  assert.equal(checkpoint.baseHead, git(workspacePath, "rev-parse", "HEAD"));
  assert.match(checkpoint.draftChangeId, /^draft_[0-9a-f]{64}$/);
  assert.match(
    git(repo, "show", "-s", "--format=%B", checkpoint.id),
    /^agent handoff\r?\n\r?\nChange-Id:/,
  );

  const movedPath = path.join(parent, "agent-workspace-moved");
  const moved = JSON.parse(
    vlab(repo, "workspace", "move", "agent-one", movedPath, "--json"),
  );
  assert.equal(moved.id, workspace.id);
  assert.equal(moved.path, movedPath);
  assert.equal(moved.status, "active");
  assert.equal(readText(movedPath, "draft.txt"), "unpublished\n");
  assert.equal(git(movedPath, "status", "--porcelain=v1"), before);
  assert.equal(git(repo, "rev-parse", checkpoint.ref), firstCheckpointRef);

  const dirtyArchive = vlabResult(repo, "workspace", "archive", "agent-one");
  assert.notEqual(dirtyArchive.status, 0);
  assert.match(dirtyArchive.stderr, /tracked or untracked changes/i);
  assert.equal(fs.existsSync(movedPath), true);

  git(movedPath, "add", "draft.txt");
  vlab(movedPath, "commit", "-m", "publish draft", "--json");
  write(movedPath, ".gitignore", "ignored.log\n");
  git(movedPath, "add", ".gitignore");
  vlab(movedPath, "commit", "-m", "ignore local log", "--json");
  write(movedPath, "ignored.log", "local only\n");

  const ignoredArchive = vlabResult(repo, "workspace", "archive", "agent-one");
  assert.notEqual(ignoredArchive.status, 0);
  assert.match(ignoredArchive.stderr, /contains ignored files/i);
  fs.rmSync(path.join(movedPath, "ignored.log"));

  const secondCheckpoint = JSON.parse(
    vlab(movedPath, "workspace", "checkpoint", "--label", "published state", "--json"),
  );
  assert.equal(secondCheckpoint.previousCheckpoint, checkpoint.id);
  assert.equal(git(repo, "rev-parse", secondCheckpoint.historyRef), checkpoint.id);
  assert.equal(git(repo, "rev-parse", secondCheckpoint.ref), secondCheckpoint.id);

  const archived = JSON.parse(
    vlab(repo, "workspace", "archive", "agent-one", "--json"),
  );
  assert.equal(archived.id, workspace.id);
  assert.equal(archived.lifecycle, "archived");
  assert.equal(archived.status, "archived");
  assert.equal(fs.existsSync(movedPath), false);
  assert.equal(git(repo, "rev-parse", checkpoint.ref), secondCheckpoint.id);
  assert.equal(git(repo, "rev-parse", secondCheckpoint.historyRef), checkpoint.id);
  assert.equal(
    git(repo, "rev-parse", `refs/heads/${workspace.compatibilityBranch}`),
    archived.lastHead,
  );
  const archivedValidation = JSON.parse(
    vlab(repo, "metadata", "validate", "--json"),
  );
  assert.equal(archivedValidation.summary.valid, true);
  assert.equal(archivedValidation.summary.warnings, 0);

  const restoredPath = path.join(parent, "agent-workspace-restored");
  const restored = JSON.parse(
    vlab(
      repo,
      "workspace",
      "restore",
      "agent-one",
      "--path",
      restoredPath,
      "--json",
    ),
  );
  assert.equal(restored.id, workspace.id);
  assert.equal(restored.lifecycle, "active");
  assert.equal(restored.path, restoredPath);
  assert.equal(restored.compatibilityBranch, workspace.compatibilityBranch);
  assert.equal(git(repo, "rev-parse", checkpoint.ref), secondCheckpoint.id);

  const repairedPath = path.join(parent, "agent-workspace-repaired");
  fs.renameSync(restoredPath, repairedPath);
  assert.equal(
    JSON.parse(vlab(repo, "workspace", "list", "--json"))[0].status,
    "missing",
  );
  const repaired = JSON.parse(
    vlab(
      repo,
      "workspace",
      "repair",
      "agent-one",
      "--path",
      repairedPath,
      "--json",
    ),
  );
  assert.equal(repaired.id, workspace.id);
  assert.equal(repaired.status, "active");
  assert.equal(repaired.path, repairedPath);
  assert.equal(git(repairedPath, "branch", "--show-current"), workspace.compatibilityBranch);

  git(repo, "worktree", "remove", repairedPath);
  const preview = JSON.parse(
    vlab(repo, "workspace", "prune", "--dry-run", "--json"),
  );
  assert.equal(preview.dryRun, true);
  assert.equal(preview.count, 1);
  assert.equal(
    JSON.parse(vlab(repo, "workspace", "list", "--json"))[0].lifecycle,
    "active",
  );
  const pruned = JSON.parse(
    vlab(repo, "workspace", "prune", "--apply", "--json"),
  );
  assert.equal(pruned.changed, true);
  assert.equal(pruned.count, 1);
  const prunedWorkspace = JSON.parse(
    vlab(repo, "workspace", "list", "--json"),
  )[0];
  assert.equal(prunedWorkspace.lifecycle, "archived");
  assert.equal(
    prunedWorkspace.lastHead,
    git(repo, "rev-parse", `refs/heads/${workspace.compatibilityBranch}`),
  );
  assert.equal(git(repo, "rev-parse", checkpoint.ref), secondCheckpoint.id);

  const finalPath = path.join(parent, "agent-workspace-final");
  const finalRestore = JSON.parse(
    vlab(repo, "workspace", "restore", "agent-one", "--path", finalPath, "--json"),
  );
  assert.equal(finalRestore.id, workspace.id);
  assert.equal(finalRestore.status, "active");
  assert.equal(git(finalPath, "branch", "--show-current"), workspace.compatibilityBranch);
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
    if (ids.has(block.semanticKey)) {
      assert.equal(block.id, ids.get(block.semanticKey));
    }
  }
  assert.equal(second.manifest.schema, "vcs-lab.spec-manifest/v3");
  assert.equal(second.cacheHit, false);
  assert.ok(second.changes.changed.length >= 1);
  assert.ok(second.changes.moved.length >= 1);

  const manifestBefore = fs.readFileSync(second.manifestPath, "utf8");
  const stored = JSON.parse(manifestBefore);
  assert.equal(stored.schema, "vcs-lab.spec-manifest/v3");
  assert.equal(Object.hasOwn(stored, "blocks"), false);
  assert.equal(stored.entityCount, second.manifest.blocks.length);
  const third = JSON.parse(vlab(repo, "spec", "index", "docs/spec.md", "--json"));
  assert.equal(third.cacheHit, true);
  assert.equal(third.written, false);
  assert.equal(fs.readFileSync(second.manifestPath, "utf8"), manifestBefore);
});

test("v2 manifests migrate to sparse v3 without changing logical IDs", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "docs/legacy.md", "# Legacy\n\nREQ-LEGACY-1: Preserve this identity.\n");
  const indexed = JSON.parse(
    vlab(repo, "spec", "index", "docs/legacy.md", "--json"),
  );
  const legacyBlocks = indexed.manifest.blocks.map((block, index) => ({
    ...block,
    id: index === 0 ? "ent_legacy_preserved_identity" : block.id,
  }));
  const legacy = {
    schema: "vcs-lab.spec-manifest/v2",
    artifactId: indexed.manifest.artifactId,
    source: indexed.manifest.source,
    sourceHash: indexed.manifest.sourceHash,
    sourceBytes: indexed.manifest.sourceBytes,
    sourceLines: indexed.manifest.sourceLines,
    representation: indexed.manifest.representation,
    parser: indexed.manifest.parser,
    blocks: legacyBlocks,
  };
  fs.writeFileSync(indexed.manifestPath, `${JSON.stringify(legacy, null, 2)}\n`);

  const migrated = JSON.parse(
    vlab(repo, "spec", "index", "docs/legacy.md", "--json"),
  );
  assert.equal(migrated.migratedFrom, "vcs-lab.spec-manifest/v2");
  assert.deepEqual(
    migrated.manifest.blocks.map((block) => block.id),
    legacyBlocks.map((block) => block.id),
  );
  const stored = JSON.parse(fs.readFileSync(indexed.manifestPath, "utf8"));
  assert.equal(stored.schema, "vcs-lab.spec-manifest/v3");
  assert.equal(Object.hasOwn(stored, "blocks"), false);
  assert.equal(
    stored.idOverrides[legacyBlocks[0].semanticKey],
    "ent_legacy_preserved_identity",
  );
});

test("forecast deterministically merges independent specification blocks", (t) => {
  const { repo } = makeRepo(t);
  createIndexedSpecDivergence(repo);
  const before = {
    head: git(repo, "rev-parse", "HEAD"),
    status: git(repo, "status", "--porcelain=v1"),
  };
  const idsBefore = new Map(
    JSON.parse(vlab(repo, "spec", "show", "docs/spec.md", "--json"))
      .manifest.blocks.map((block) => [block.semanticKey, block.id]),
  );

  const forecast = JSON.parse(
    vlab(repo, "forecast", "feature", "--git-session", "--json"),
  );
  assert.equal(forecast.schema, "vcs-lab.forecast/v2");
  assert.equal(forecast.status, "complete");
  assert.equal(forecast.counts.semanticSpec, 1);
  assert.equal(forecast.counts.exactResolution, 0);
  assert.equal(forecast.steps[0].outcome, "semantic-spec-merge");
  assert.equal(forecast.approvedSpecMerges.length, 1);
  assert.deepEqual(forecast.steps[0].semanticMerges[0].counts, {
    "theirs-edit": 1,
    "ours-edit": 1,
  });
  assert.ok(forecast.timings.phases.planningMs >= 0);
  assert.ok(forecast.timings.worktree.applicationMs >= 0);
  assert.ok(forecast.timings.git.count > 0);
  assert.ok(forecast.timings.git.sessionQueries > 0);
  assert.ok(forecast.timings.git.processes < forecast.timings.git.count);
  assert.equal(git(repo, "rev-parse", "HEAD"), before.head);
  assert.equal(git(repo, "status", "--porcelain=v1"), before.status);

  const fallback = JSON.parse(
    vlab(repo, "forecast", "feature", "--no-git-session", "--json"),
  );
  assert.equal(fallback.predictedResultTree, forecast.predictedResultTree);
  assert.deepEqual(fallback.plan.changes, forecast.plan.changes);
  assert.equal(fallback.timings.git.sessionQueries, 0);
  assert.equal(fallback.timings.git.processes, fallback.timings.git.count);
  assert.ok(forecast.timings.git.processes < fallback.timings.git.processes);

  const result = JSON.parse(
    vlab(
      repo,
      "reconcile",
      "feature",
      "--use-forecast",
      forecast.id,
      "--git-session",
      "--json",
    ),
  );
  assert.equal(result.receipt.schema, "vcs-lab.reconciliation/v6");
  assert.equal(result.receipt.resultTree, forecast.predictedResultTree);
  assert.equal(result.receipt.applied[0].semanticMerges.length, 1);
  assert.equal(
    result.receipt.applied[0].semanticMerges[0].selectionMethod,
    "forecast-batch",
  );
  assert.equal(result.receipt.applied[0].semanticMerges[0].decision, "accepted");
  assert.ok(
    result.receipt.timings.git.count <= 10,
    JSON.stringify(result.receipt.timings.git, null, 2),
  );
  assert.ok(
    result.receipt.timings.git.processes < result.receipt.timings.git.count,
    JSON.stringify(result.receipt.timings.git, null, 2),
  );
  assert.equal(
    readText(repo, "docs/spec.md"),
    "# Alpha\n\nsource alpha\n\n# Beta\n\ntarget beta\n",
  );
  const storedResultManifest = JSON.parse(
    fs.readFileSync(path.join(repo, ".vcs-lab/specs/docs/spec.md.json"), "utf8"),
  );
  assert.equal(
    storedResultManifest.sourceBlob,
    git(repo, "rev-parse", "HEAD:docs/spec.md"),
  );
  const indexedBatch = JSON.parse(
    vlab(repo, "spec", "index", "--all", "--json"),
  );
  assert.equal(indexedBatch.blobCacheHits, 1);
  assert.equal(indexedBatch.contentReads, 0);
  const indexed = JSON.parse(vlab(repo, "spec", "show", "docs/spec.md", "--json"));
  for (const block of indexed.manifest.blocks) {
    assert.equal(block.id, idsBefore.get(block.semanticKey));
  }
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("same-block specification edits remain an explicit forecast blocker", (t) => {
  const { repo } = makeRepo(t);
  const { base, source, target } = createIndexedSpecDivergence(repo, {
    sameBlock: true,
  });
  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
  assert.equal(forecast.status, "blocked");
  assert.equal(forecast.blockedReason, "semantic-spec-conflict");
  const semantic = forecast.steps[0].conflicts.find(
    (conflict) => conflict.semanticSpec,
  ).semanticSpec;
  assert.equal(semantic.status, "blocked");
  assert.equal(semantic.conflicts[0].type, "same-block-edit");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");

  const direct = JSON.parse(
    vlab(
      repo,
      "spec",
      "merge-plan",
      "docs/spec.md",
      base.commit,
      target.commit,
      source.commit,
      "--json",
    ),
  );
  assert.equal(direct.status, "blocked");
  assert.equal(direct.conflicts[0].type, "same-block-edit");
});

test("spec merge combines a block move with an edit but blocks delete versus edit", (t) => {
  const { repo } = makeRepo(t);
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nbase alpha\n\n# Beta\n\nbase beta\n\n# Gamma\n\nbase gamma\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base blocks"));

  git(repo, "switch", "-c", "feature", base.commit);
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nbase alpha\n\n# Beta\n\nsource beta\n\n# Gamma\n\nbase gamma\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md");
  git(repo, "add", ".");
  const source = JSON.parse(vlab(repo, "commit", "-m", "edit beta"));

  git(repo, "switch", "-c", "target-move", base.commit);
  write(
    repo,
    "docs/spec.md",
    "# Beta\n\nbase beta\n\n# Alpha\n\nbase alpha\n\n# Gamma\n\nbase gamma\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md");
  git(repo, "add", ".");
  const moved = JSON.parse(vlab(repo, "commit", "-m", "move beta"));
  const movePlan = JSON.parse(
    vlab(
      repo,
      "spec",
      "merge-plan",
      "docs/spec.md",
      base.commit,
      moved.commit,
      source.commit,
      "--json",
    ),
  );
  assert.equal(movePlan.status, "clean");
  assert.equal(movePlan.ordering.decision, "ours-move");
  assert.match(movePlan.result.markdown, /^# Beta\n\nsource beta/);

  git(repo, "switch", "-c", "target-delete", base.commit);
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nbase alpha\n\n# Gamma\n\nbase gamma\n",
  );
  vlab(repo, "spec", "index", "docs/spec.md");
  git(repo, "add", ".");
  const deleted = JSON.parse(vlab(repo, "commit", "-m", "delete beta"));
  const deletePlan = JSON.parse(
    vlab(
      repo,
      "spec",
      "merge-plan",
      "docs/spec.md",
      base.commit,
      deleted.commit,
      source.commit,
      "--json",
    ),
  );
  assert.equal(deletePlan.status, "blocked");
  assert.equal(deletePlan.conflicts[0].type, "delete-vs-edit");
});

test("ordinary unindexed Markdown conflicts still produce a conservative forecast", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "docs.md", "base\n");
  git(repo, "add", "docs.md");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base markdown"));
  vlab(repo, "init");
  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "docs.md", "source\n");
  git(repo, "add", "docs.md");
  vlab(repo, "commit", "-m", "source markdown");
  git(repo, "switch", "main");
  write(repo, "docs.md", "target\n");
  git(repo, "add", "docs.md");
  vlab(repo, "commit", "-m", "target markdown");

  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
  assert.equal(forecast.status, "blocked");
  assert.equal(
    forecast.blockedReason,
    "semantic-spec-metadata-unavailable",
  );
  const semantic = forecast.steps[0].conflicts.find(
    (conflict) => conflict.path === "docs.md",
  ).semanticSpec;
  assert.equal(semantic.conflicts[0].type, "semantic-metadata-unavailable");
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("a paused reconciliation can explicitly apply a deterministic spec merge", (t) => {
  const { repo } = makeRepo(t);
  createIndexedSpecDivergence(repo);
  const attempt = vlabResult(repo, "reconcile", "feature");
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /deterministic spec merge/i);

  const status = JSON.parse(vlab(repo, "spec", "status", "--json"));
  assert.equal(status.active, true);
  assert.equal(status.plans[0].status, "clean");
  assert.deepEqual(status.plans[0].counts, {
    "theirs-edit": 1,
    "ours-edit": 1,
  });
  const applied = JSON.parse(
    vlab(repo, "spec", "resolve", "--all", "--json"),
  );
  assert.equal(applied.applied.length, 1);
  assert.doesNotMatch(git(repo, "status", "--porcelain=v1"), /^UU|^AA|^DU|^UD/m);

  const result = JSON.parse(vlab(repo, "reconcile", "--continue", "--json"));
  assert.equal(result.receipt.applied[0].resolutions.length, 0);
  assert.equal(
    result.receipt.applied[0].semanticMerges[0].selectionMethod,
    "explicit-spec-merge",
  );
  assert.equal(result.receipt.applied[0].semanticMerges[0].decision, "accepted");
  assert.equal(JSON.parse(vlab(repo, "resolve", "list", "--json")).length, 0);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("an edited semantic suggestion requires reindexing and is audited as modified", (t) => {
  const { repo } = makeRepo(t);
  createIndexedSpecDivergence(repo);
  assert.notEqual(vlabResult(repo, "reconcile", "feature").status, 0);
  vlab(repo, "spec", "resolve", "--all", "--json");
  write(
    repo,
    "docs/spec.md",
    "# Alpha\n\nsource alpha\n\n# Beta\n\nhuman-adjusted beta\n",
  );
  git(repo, "add", "docs/spec.md");
  const stale = vlabResult(repo, "reconcile", "--continue");
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /manifest.*stale/i);

  vlab(repo, "spec", "index", "docs/spec.md", "--json");
  git(repo, "add", "docs/spec.md", ".vcs-lab/specs/docs/spec.md.json");
  const result = JSON.parse(vlab(repo, "reconcile", "--continue", "--json"));
  const merge = result.receipt.applied[0].semanticMerges[0];
  assert.equal(merge.decision, "modified");
  assert.notEqual(merge.actualMarkdownHash, merge.resultMarkdownHash);
  assert.notEqual(merge.actualManifestHash, merge.resultManifestHash);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("semantic spec forecasts are stable with checkout-time CRLF conversion", (t) => {
  const { repo } = makeRepo(t);
  git(repo, "config", "core.autocrlf", "true");
  createIndexedSpecDivergence(repo);
  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
  assert.equal(forecast.status, "complete");
  assert.equal(forecast.counts.semanticSpec, 1);
  const result = JSON.parse(
    vlab(
      repo,
      "reconcile",
      "feature",
      "--use-forecast",
      forecast.id,
      "--json",
    ),
  );
  assert.equal(result.receipt.resultTree, forecast.predictedResultTree);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
});

test("batch spec indexing skips unchanged manifests and measures generated corpora", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "docs/one.md", "# One\n\nFirst body.\n");
  write(repo, "docs/two.md", "# Two\n\nSecond body.\n");
  const cold = JSON.parse(vlab(repo, "spec", "index", "--all", "--json"));
  assert.equal(cold.files, 2);
  assert.equal(cold.cacheHits, 0);
  assert.equal(cold.manifestsWritten, 2);
  const unchanged = JSON.parse(
    vlab(repo, "spec", "index", "--all", "--json"),
  );
  assert.equal(unchanged.cacheHits, 2);
  assert.equal(unchanged.manifestsWritten, 0);
  assert.equal(unchanged.contentReads, 0);
  assert.equal(unchanged.blobCacheHits, 2);

  write(repo, "docs/two.md", "# Two\n\nSecond body changed.\n");
  const incremental = JSON.parse(
    vlab(repo, "spec", "index", "--all", "--json"),
  );
  assert.equal(incremental.cacheHits, 1);
  assert.equal(incremental.manifestsWritten, 1);
  assert.equal(incremental.contentReads, 1);
  assert.equal(incremental.blobCacheHits, 1);
  assert.equal(incremental.changes.changed, 1);

  const benchmark = JSON.parse(
    vlab(
      repo,
      "spec",
      "benchmark",
      "--documents",
      "2",
      "--blocks",
      "3",
      "--json",
    ),
  );
  assert.equal(benchmark.documents, 2);
  assert.equal(benchmark.blocksPerDocument, 3);
  assert.equal(benchmark.unchanged.cacheHits, 2);
  assert.equal(benchmark.unchanged.manifestsWritten, 0);
  assert.equal(benchmark.oneBlockChanged.manifestsWritten, 1);
  assert.equal(benchmark.schema, "vcs-lab.spec-benchmark/v2");
  assert.equal(benchmark.manifestSchema, "vcs-lab.spec-manifest/v3");
  assert.equal(benchmark.unchanged.contentReads, 0);
  assert.equal(benchmark.unchanged.blobCacheHits, 2);
  assert.ok(benchmark.manifestBytes < benchmark.legacyV2EquivalentBytes);
  assert.ok(benchmark.metadataReductionPercent > 80);
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

  const forecast = JSON.parse(vlab(repo, "forecast", "left", "--json"));
  assert.equal(forecast.status, "review-required");
  assert.equal(forecast.candidateDecisionRequired, true);
  assert.equal(forecast.predictedResultTree, null);
  const acceptedForecast = JSON.parse(
    vlab(repo, "forecast", "left", "--accept-candidates", "--json"),
  );
  assert.equal(acceptedForecast.status, "complete");
  assert.equal(acceptedForecast.candidateDecisionRequired, false);
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

test("doctor and repository-scale benchmarks expose process costs without repository content", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-m", "base");
  const doctor = JSON.parse(
    vlab(
      repo,
      "doctor",
      "--benchmark",
      "--samples",
      "5",
      "--warmup",
      "2",
      "--git-session",
    ),
  );
  assert.equal(doctor.ok, true);
  assert.equal(doctor.benchmark.length, 4);
  assert.ok(doctor.benchmark.every((probe) => probe.samplesMs.length === 5));
  assert.ok(doctor.benchmark.every((probe) => probe.warmup === 2));
  assert.ok(doctor.benchmark.every((probe) => probe.p95Ms >= probe.medianMs));
  assert.equal(doctor.objectSession.enabled, true);
  assert.equal(doctor.objectSession.logicalReads, 15);
  assert.equal(doctor.objectSession.git.processes, 1);
  assert.ok(doctor.objectSession.git.sessionQueries >= 3);
  assert.ok(doctor.objectSession.git.cacheHits >= 8);

  const scaleCallerBefore = {
    head: git(repo, "rev-parse", "HEAD"),
    status: git(repo, "status", "--porcelain=v1"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  const scaleFixtureDirectoriesBefore = fs.readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith("vcs-lab-scale-benchmark-"))
    .sort();
  const scale = JSON.parse(
    vlab(
      repo,
      "metadata",
      "benchmark",
      "--history",
      "4",
      "--workspaces",
      "2",
      "--notes",
      "3",
      "--resolutions",
      "2",
      "--samples",
      "2",
      "--budget-ms",
      "5000",
      "--json",
    ),
  );
  assert.equal(scale.schema, "vcs-lab.repository-scale-benchmark/v1");
  assert.deepEqual(scale.fixture, {
    profile: "custom-v1",
    historyDepth: 4,
    workspaces: 2,
    causalNotes: 3,
    resolutions: 2,
    totalNoteTargets: 5,
    totalNoteRecords: 5,
  });
  assert.equal(scale.coverage.documentationVolume.companionSchema, "vcs-lab.spec-benchmark/v2");
  assert.equal(scale.setup.expectedAbsentProbeFailures, 9);
  assert.equal(scale.setup.unexpectedGitFailures, 0);
  assert.equal(scale.measurements.history.result.commits, 4);
  assert.equal(scale.measurements.gitWorktrees.result.worktrees, 3);
  assert.equal(scale.measurements.workspaceRegistry.result.workspaces, 2);
  assert.deepEqual(scale.measurements.workspaceStatus.result, {
    workspaces: 2,
    active: 2,
    dirty: 0,
  });
  assert.equal(scale.measurements.noteCatalog.result.records, 5);
  assert.equal(scale.measurements.resolutionCatalog.result.resolutions, 2);
  assert.deepEqual(scale.measurements.metadataStatus.result, {
    valid: true,
    acceptedPortableRecords: 5,
    noteTargets: 5,
    resolutionRefs: 2,
    registeredWorkspaces: 2,
    materializedWorktrees: 3,
  });
  assert.ok(
    Object.values(scale.measurements).every(
      (measurement) => measurement.samples.length === 2,
    ),
  );
  assert.equal(
    scale.analysis.processAmplification.workspaceStatusProcessesPerWorkspace,
    3,
  );
  assert.ok(
    scale.analysis.processAmplification.noteCatalogProcessesPerTarget < 1,
  );
  assert.ok(
    scale.analysis.processAmplification.resolutionCatalogProcessesPerResolution > 3,
  );
  assert.equal(scale.analysis.nextAction, "batch-process-amplified-scans");
  assert.equal(scale.analysis.persistentIndex.recommendedNow, false);
  assert.equal(scale.analysis.residentService.recommendedNow, false);
  assert.deepEqual(
    scale.analysis.recommendations.map((item) => item.area),
    ["workspace-status", "resolution-catalog", "note-catalog"],
  );
  assert.deepEqual(scale.privacy, {
    repositoryPathsIncluded: false,
    objectIdsIncluded: false,
    fileContentsIncluded: false,
    commitMessagesIncluded: false,
  });
  assert.equal(scale.cleanup.temporaryFixtureRemoved, true);
  assert.doesNotMatch(JSON.stringify(scale), /vcs-lab-scale-benchmark-/);
  assert.deepEqual(
    fs.readdirSync(os.tmpdir())
      .filter((entry) => entry.startsWith("vcs-lab-scale-benchmark-"))
      .sort(),
    scaleFixtureDirectoriesBefore,
  );
  assert.deepEqual({
    head: git(repo, "rev-parse", "HEAD"),
    status: git(repo, "status", "--porcelain=v1"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  }, scaleCallerBefore);

  const traced = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", VLAB_TRACE: "1" },
  });
  assert.equal(traced.status, 0);
  assert.match(traced.stderr, /\[vlab trace\].*git --version/);

  const tracedOption = spawnSync(
    process.execPath,
    [cli, "--trace-git", "--git-session", "merge-plan", "HEAD", "--json"],
    {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  assert.equal(tracedOption.status, 0);
  assert.match(tracedOption.stderr, /persistent process|cache hit/);

  const readDiagnostics = (filePath) => fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));

  const shutdownDiagnosticsPath = path.join(parent, "shutdown-diagnostics.log");
  const planned = spawnSync(
    process.execPath,
    [cli, "merge-plan", "HEAD", "--git-session", "--json"],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        VLAB_GIT_SESSION_DIAGNOSTICS: "1",
        VLAB_GIT_SESSION_DIAGNOSTICS_FILE: shutdownDiagnosticsPath,
      },
    },
  );
  assert.equal(planned.status, 0);
  const shutdownDiagnostics = readDiagnostics(shutdownDiagnosticsPath);
  const gitClose = shutdownDiagnostics.findIndex(
    (event) => event.event === "git-close",
  );
  const closeFinish = shutdownDiagnostics.findIndex(
    (event) => event.event === "close-finish",
  );
  assert.ok(gitClose >= 0);
  assert.ok(closeFinish > gitClose);
  assert.equal(
    shutdownDiagnostics.some((event) => event.event === "close-git-kill"),
    false,
  );

  const diagnosticsPath = path.join(parent, "lazy-session-diagnostics.log");
  write(repo, "dirty.txt", "dirty\n");
  const rejected = spawnSync(
    process.execPath,
    [cli, "reconcile", "HEAD", "--git-session"],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        VLAB_GIT_SESSION_DIAGNOSTICS: "1",
        VLAB_GIT_SESSION_DIAGNOSTICS_FILE: diagnosticsPath,
      },
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /worktree must be clean/i);

  const diagnostics = readDiagnostics(diagnosticsPath);
  const statusStart = diagnostics.findIndex(
    (event) => event.event === "git-spawn-start" && event.command === "status",
  );
  const statusEnd = diagnostics.findIndex(
    (event) => event.event === "git-spawn-end" && event.command === "status",
  );
  const closedWithoutWorker = diagnostics.findIndex(
    (event) => event.event === "session-close-no-worker",
  );
  assert.ok(statusStart >= 0);
  assert.ok(statusEnd > statusStart);
  assert.ok(closedWithoutWorker > statusEnd);
  assert.equal(
    diagnostics.some((event) => event.event === "worker-create-start"),
    false,
  );
});

test("merge planning batches commit metadata instead of spawning per commit", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "history.txt", "base\n");
  git(repo, "add", "history.txt");
  git(repo, "commit", "-m", "base");
  git(repo, "switch", "-c", "feature");
  for (let index = 1; index <= 12; index += 1) {
    write(repo, "history.txt", `${index}\n`);
    git(repo, "add", "history.txt");
    git(
      repo,
      "commit",
      "-m",
      `feature ${index}\n\nChange-Id: ch_bulk_${index}`,
    );
  }
  git(repo, "switch", "main");

  const planned = spawnSync(
    process.execPath,
    [cli, "merge-plan", "feature", "--git-session", "--trace-git", "--json"],
    {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  assert.equal(planned.status, 0);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.changes.length, 12);
  assert.equal(plan.counts.new, 12);
  assert.equal((planned.stderr.match(/git log /g) ?? []).length, 2);
  assert.equal((planned.stderr.match(/git show /g) ?? []).length, 0);

  const fallback = JSON.parse(
    vlab(repo, "merge-plan", "feature", "--no-git-session", "--json"),
  );
  assert.deepEqual(fallback, plan);

  const failedSession = spawnSync(
    process.execPath,
    [cli, "merge-plan", "feature", "--git-session", "--trace-git", "--json"],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        VLAB_TEST_GIT_SESSION_FAILURE: "1",
      },
    },
  );
  assert.equal(failedSession.status, 0);
  assert.deepEqual(JSON.parse(failedSession.stdout), plan);
  assert.match(failedSession.stderr, /using ordinary processes/i);
});

test("forecast previews and batch-applies pinned exact resolutions without mutation", (t) => {
  const { repo } = makeRepo(t);
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
  write(repo, "shared.txt", "remembered\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "reconcile", "--continue", "--json");

  git(repo, "switch", "-c", "source-two", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "source two");
  git(repo, "switch", "-c", "target-two", base.commit);
  write(repo, "shared.txt", "target\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "target two");

  const before = {
    head: git(repo, "rev-parse", "HEAD"),
    status: git(repo, "status", "--porcelain=v1"),
    worktrees: git(repo, "worktree", "list", "--porcelain"),
  };
  const forecast = JSON.parse(vlab(repo, "forecast", "source-two", "--json"));
  assert.equal(forecast.status, "complete");
  assert.equal(forecast.counts.exactResolution, 1);
  assert.equal(forecast.approvedResolutions.length, 1);
  assert.equal(forecast.steps[0].outcome, "exact-resolution");
  assert.equal(forecast.steps[0].resolutions[0].decision, "accepted");
  assert.equal(
    forecast.steps[0].resolutions[0].selectionMethod,
    "forecast-batch",
  );
  assert.ok(forecast.predictedResultTree);
  assert.ok(forecast.timings.forecastMs > 0);
  assert.equal(git(repo, "rev-parse", "HEAD"), before.head);
  assert.equal(git(repo, "status", "--porcelain=v1"), before.status);
  assert.equal(git(repo, "worktree", "list", "--porcelain"), before.worktrees);

  const reconciled = JSON.parse(
    vlab(
      repo,
      "reconcile",
      "source-two",
      "--use-forecast",
      forecast.id,
      "--json",
    ),
  );
  assert.equal(reconciled.receipt.forecastId, forecast.id);
  assert.equal(reconciled.receipt.resultTree, forecast.predictedResultTree);
  assert.equal(
    reconciled.receipt.applied[0].resolutions[0].selectionMethod,
    "forecast-batch",
  );
  assert.equal(
    reconciled.receipt.applied[0].resolutions[0].decision,
    "accepted",
  );
  assert.ok(reconciled.receipt.timings.activeApplicationMs > 0);
  assert.ok(reconciled.receipt.timings.elapsedWallMs >= 0);
  assert.equal(git(repo, "status", "--porcelain=v1"), "");
  assert.equal(
    JSON.parse(vlab(repo, "reconcile", "--status", "--json")).active,
    false,
  );
});

test("stale forecasts fail before starting a reconciliation", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", "base.txt");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "feature\n");
  git(repo, "add", "feature.txt");
  vlab(repo, "commit", "-m", "feature");
  git(repo, "switch", "main");
  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
  assert.equal(forecast.status, "complete");

  write(repo, "target.txt", "target moved\n");
  git(repo, "add", "target.txt");
  const moved = JSON.parse(vlab(repo, "commit", "-m", "move target"));
  const attempt = vlabResult(
    repo,
    "reconcile",
    "feature",
    "--use-forecast",
    forecast.id,
  );
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /no longer matches this reconciliation/i);
  assert.equal(git(repo, "rev-parse", "HEAD"), moved.commit);
  assert.equal(
    JSON.parse(vlab(repo, "reconcile", "--status", "--json")).active,
    false,
  );
});

test("forecast result mismatch blocks receipts and remains abortable", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", "base.txt");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "feature\n");
  git(repo, "add", "feature.txt");
  vlab(repo, "commit", "-m", "feature");
  git(repo, "switch", "main");
  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
  const relativeForecastPath = git(
    repo,
    "rev-parse",
    "--git-path",
    `vcs-lab/forecasts/${forecast.id}.json`,
  );
  const savedPath = path.resolve(repo, relativeForecastPath);
  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8"));
  saved.predictedResultTree = saved.plan.targetTree;
  fs.writeFileSync(savedPath, `${JSON.stringify(saved, null, 2)}\n`);

  const attempt = vlabResult(
    repo,
    "reconcile",
    "feature",
    "--use-forecast",
    forecast.id,
  );
  assert.notEqual(attempt.status, 0);
  assert.match(attempt.stderr, /result does not match forecast/i);
  const status = JSON.parse(vlab(repo, "reconcile", "--status", "--json"));
  assert.equal(status.active, true);
  assert.equal(status.state, "forecast-mismatch");
  assert.deepEqual(JSON.parse(vlab(repo, "receipts", "--json")), []);
  const aborted = JSON.parse(vlab(repo, "reconcile", "--abort", "--json"));
  assert.equal(aborted.restoredHead, base.commit);
  assert.equal(fs.existsSync(path.join(repo, "feature.txt")), false);
});

test("workspace forecasts keep live drafts isolated and can pin an immutable source checkpoint", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");

  const targetPath = path.join(parent, "target-agent");
  const sourcePath = path.join(parent, "source-agent");
  vlab(
    repo,
    "workspace",
    "create",
    "target-agent",
    "--path",
    targetPath,
    "--json",
  );
  vlab(
    repo,
    "workspace",
    "create",
    "source-agent",
    "--path",
    sourcePath,
    "--json",
  );
  write(targetPath, "shared.txt", "target\n");
  git(targetPath, "add", "shared.txt");
  vlab(targetPath, "commit", "-m", "target edit");
  write(sourcePath, "shared.txt", "source\n");
  git(sourcePath, "add", "shared.txt");
  vlab(sourcePath, "commit", "-m", "source edit");
  write(sourcePath, "draft.txt", "uncommitted agent draft\n");

  const targetHead = git(targetPath, "rev-parse", "HEAD");
  const sourceHead = git(sourcePath, "rev-parse", "HEAD");
  const sourceStatus = git(sourcePath, "status", "--porcelain=v1");
  const forecast = JSON.parse(
    vlab(
      repo,
      "workspace",
      "forecast",
      "target-agent",
      "source-agent",
      "--git-session",
      "--json",
    ),
  );
  assert.equal(forecast.status, "blocked");
  assert.equal(forecast.blockedReason, "missing-exact-resolution");
  assert.equal(forecast.steps[0].outcome, "blocked-conflict");
  assert.deepEqual(
    forecast.steps[0].conflicts.map((conflict) => conflict.path),
    ["shared.txt"],
  );
  assert.equal(forecast.workspaceComparison.scope, "committed-heads");
  assert.equal(
    forecast.workspaceComparison.source.ignoredDirtyFiles,
    1,
  );
  assert.equal(forecast.targetWorktree, targetPath);
  assert.ok(forecast.timings.git.sessionQueries > 0);
  assert.ok(forecast.timings.git.processes < forecast.timings.git.count);
  assert.equal(git(targetPath, "rev-parse", "HEAD"), targetHead);
  assert.equal(git(sourcePath, "rev-parse", "HEAD"), sourceHead);
  assert.equal(git(sourcePath, "status", "--porcelain=v1"), sourceStatus);
  assert.equal(
    JSON.parse(
      vlab(
        targetPath,
        "reconcile",
        "--status",
        "--json",
      ),
    ).active,
    false,
  );

  const overlayTargetPath = path.join(parent, "overlay-target");
  const overlaySourcePath = path.join(parent, "overlay-source");
  vlab(
    repo,
    "workspace",
    "create",
    "overlay-target",
    "--path",
    overlayTargetPath,
    "--json",
  );
  vlab(
    repo,
    "workspace",
    "create",
    "overlay-source",
    "--path",
    overlaySourcePath,
    "--json",
  );
  write(overlayTargetPath, "target.txt", "target committed\n");
  git(overlayTargetPath, "add", "target.txt");
  vlab(overlayTargetPath, "commit", "-m", "target committed change", "--json");
  write(overlaySourcePath, "source.txt", "source committed\n");
  git(overlaySourcePath, "add", "source.txt");
  vlab(overlaySourcePath, "commit", "-m", "source committed change", "--json");
  const overlaySourceHead = git(overlaySourcePath, "rev-parse", "HEAD");
  write(overlaySourcePath, "draft.txt", "captured draft\n");
  const checkpoint = JSON.parse(
    vlab(
      overlaySourcePath,
      "workspace",
      "checkpoint",
      "--label",
      "reviewable draft",
      "--json",
    ),
  );
  write(overlaySourcePath, "draft.txt", "new live draft\n");
  write(overlaySourcePath, "live-only.txt", "not captured\n");

  const overlayTargetHead = git(overlayTargetPath, "rev-parse", "HEAD");
  const overlaySourceStatus = git(
    overlaySourcePath,
    "status",
    "--porcelain=v1",
  );
  const overlayForecast = JSON.parse(
    vlab(
      repo,
      "workspace",
      "forecast",
      "overlay-target",
      "overlay-source",
      "--source-checkpoint",
      "--json",
    ),
  );
  assert.equal(overlayForecast.status, "complete");
  assert.equal(overlayForecast.scope, "source-checkpoint");
  assert.equal(overlayForecast.sourceHead, checkpoint.id);
  assert.equal(overlayForecast.workspaceComparison.scope, "source-checkpoint");
  assert.equal(
    overlayForecast.workspaceComparison.source.checkpoint.id,
    checkpoint.id,
  );
  assert.equal(
    overlayForecast.workspaceComparison.source.checkpoint.baseHead,
    overlaySourceHead,
  );
  assert.equal(
    overlayForecast.workspaceComparison.source.ignoredDirtyFiles,
    2,
  );
  assert.ok(
    overlayForecast.plan.changes.some(
      (change) => change.changeId === checkpoint.draftChangeId,
    ),
  );
  assert.equal(
    git(repo, "show", `${overlayForecast.predictedResultTree}:draft.txt`),
    "captured draft",
  );
  assert.doesNotMatch(
    git(repo, "ls-tree", "-r", "--name-only", overlayForecast.predictedResultTree),
    /live-only\.txt/,
  );
  assert.equal(git(overlayTargetPath, "rev-parse", "HEAD"), overlayTargetHead);
  assert.equal(git(overlaySourcePath, "rev-parse", "HEAD"), overlaySourceHead);
  assert.equal(
    git(overlaySourcePath, "status", "--porcelain=v1"),
    overlaySourceStatus,
  );
  assert.match(
    vlab(
      repo,
      "workspace",
      "forecast",
      "overlay-target",
      "overlay-source",
      "--source-checkpoint",
    ),
    /scope\s+immutable source checkpoint/,
  );

  const applied = JSON.parse(
    vlab(
      overlayTargetPath,
      "reconcile",
      checkpoint.id,
      "--use-forecast",
      overlayForecast.id,
      "--json",
    ),
  );
  assert.equal(applied.receipt.forecastId, overlayForecast.id);
  assert.equal(readText(overlayTargetPath, "draft.txt"), "captured draft\n");
  assert.equal(fs.existsSync(path.join(overlayTargetPath, "live-only.txt")), false);
  assert.equal(git(overlayTargetPath, "status", "--porcelain=v1"), "");
  assert.equal(
    git(overlaySourcePath, "status", "--porcelain=v1"),
    overlaySourceStatus,
  );

  const reviewedAfterApply = JSON.parse(
    vlab(
      repo,
      "workspace",
      "forecast",
      "overlay-target",
      "overlay-source",
      "--source-checkpoint",
      "--json",
    ),
  );

  git(overlaySourcePath, "add", "draft.txt", "live-only.txt");
  vlab(overlaySourcePath, "commit", "-m", "advance after checkpoint", "--json");
  const staleApproval = vlabResult(
    overlayTargetPath,
    "reconcile",
    checkpoint.id,
    "--use-forecast",
    reviewedAfterApply.id,
    "--json",
  );
  assert.notEqual(staleApproval.status, 0);
  assert.match(staleApproval.stderr, /source workspace head/i);
  assert.equal(git(overlayTargetPath, "status", "--porcelain=v1"), "");
  const staleCheckpoint = vlabResult(
    repo,
    "workspace",
    "forecast",
    "overlay-target",
    "overlay-source",
    "--source-checkpoint",
  );
  assert.notEqual(staleCheckpoint.status, 0);
  assert.match(staleCheckpoint.stderr, /moved after checkpoint/i);
});

test("metadata validation quarantines invalid causal claims from coverage", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "portable\n");
  git(repo, "add", ".");
  const feature = JSON.parse(vlab(repo, "commit", "-m", "feature"));
  git(repo, "switch", "main");
  const target = git(repo, "rev-parse", "HEAD");
  const targetTree = git(repo, "rev-parse", "HEAD^{tree}");
  const missing = "f".repeat(40);
  const invalid = {
    schema: "vcs-lab.note/v1",
    records: [
      {
        schema: "vcs-lab.landing/v99",
        type: "landing",
        id: "land_unknown_schema",
        absorbedCommits: [feature.commit],
        absorbedChanges: [feature.changeId],
      },
      {
        schema: "vcs-lab.landing/v1",
        type: "landing",
        id: "land_dangling_reference",
        mode: "hard-squash",
        sourceRef: "feature",
        sourceHead: missing,
        targetBefore: target,
        landingCommit: target,
        base: base.commit,
        absorbedCommits: [feature.commit],
        absorbedChanges: [feature.changeId],
        resultTree: targetTree,
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
  exec(
    "git",
    ["notes", "--ref=vcs-lab", "add", "-f", "-F", "-", target],
    repo,
    { input: `${JSON.stringify(invalid, null, 2)}\n` },
  );

  const status = JSON.parse(vlab(repo, "metadata", "status", "--json"));
  assert.equal(status.scopes.sharedPortable.notes.quarantinedCount, 2);
  assert.ok(status.diagnostics.some((item) => item.code === "unknown-schema"));
  assert.ok(status.diagnostics.some((item) => item.code === "missing-referenced-object"));
  assert.equal(status.trust.cryptographicallyTrusted, false);

  const validation = vlabResult(repo, "metadata", "validate", "--json");
  assert.notEqual(validation.status, 0);
  assert.equal(JSON.parse(validation.stdout).summary.valid, false);

  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.covered, 0);
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.changes[0].changeId, feature.changeId);
});

test("metadata envelope round-trips accepted facts between clones idempotently", (t) => {
  const { repo, parent } = makeRepo(t);
  write(repo, "shared.txt", "base\n");
  git(repo, "add", ".");
  const base = JSON.parse(vlab(repo, "commit", "-m", "base"));
  vlab(repo, "init");

  git(repo, "switch", "-c", "feature", base.commit);
  write(repo, "feature.txt", "one\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature one");
  write(repo, "feature.txt", "one\ntwo\n");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "feature two");
  git(repo, "switch", "main");
  vlab(repo, "hard-squash", "feature", "--json");
  git(repo, "switch", "feature");
  write(repo, "continuation.txt", "three\n");
  git(repo, "add", ".");
  const continuation = JSON.parse(vlab(repo, "commit", "-m", "feature continuation"));

  git(repo, "switch", "-c", "conflict-source", base.commit);
  write(repo, "shared.txt", "source\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "source conflict");
  git(repo, "switch", "main");
  write(repo, "shared.txt", "target\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "commit", "-m", "target conflict");
  assert.notEqual(vlabResult(repo, "reconcile", "conflict-source").status, 0);
  write(repo, "shared.txt", "resolved\n");
  git(repo, "add", "shared.txt");
  vlab(repo, "reconcile", "--continue", "--json");
  const sourceCatalog = JSON.parse(vlab(repo, "resolve", "list", "--json"));
  assert.equal(sourceCatalog.length, 1);

  write(repo, "docs/spec.md", "# Portable\n\nREQ-PORTABLE-1: Keep identity.\n");
  vlab(repo, "spec", "index", "docs/spec.md", "--json");
  git(repo, "add", ".");
  vlab(repo, "commit", "-m", "portable specification");
  const sourceSpec = JSON.parse(vlab(repo, "spec", "show", "docs/spec.md", "--json"));

  const workspacePath = path.join(parent, "metadata-workspace");
  vlab(repo, "workspace", "create", "metadata-agent", "--path", workspacePath, "--json");
  write(workspacePath, "private-draft.txt", "private\n");
  vlab(workspacePath, "workspace", "checkpoint", "--label", "excluded", "--json");
  vlab(repo, "forecast", "feature", "--json");

  const attachment = git(repo, "rev-parse", "HEAD");
  const unknown = {
    schema: "vcs-lab.note/v1",
    records: [{
      schema: "vcs-lab.future-proof/v9",
      type: "landing",
      id: "future_quarantined",
      absorbedCommits: [continuation.commit],
    }],
  };
  exec(
    "git",
    ["notes", "--ref=vcs-lab", "add", "-f", "-F", "-", attachment],
    repo,
    { input: `${JSON.stringify(unknown, null, 2)}\n` },
  );
  const sourceStatus = JSON.parse(vlab(repo, "metadata", "status", "--json"));
  assert.equal(sourceStatus.scopes.sharedPortable.notes.quarantinedCount, 1);

  const beforePlan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(
    beforePlan.changes.find((item) => item.changeId === continuation.changeId).status,
    "new",
  );

  const envelopePath = path.join(parent, "portable-metadata");
  const exported = JSON.parse(
    vlab(repo, "metadata", "export", envelopePath, "--json"),
  );
  assert.equal(exported.quarantinedRecords, 1);
  assert.ok(exported.bytes > 0);

  const envelopeManifest = JSON.parse(
    fs.readFileSync(path.join(envelopePath, "manifest.json"), "utf8"),
  );
  const secondEnvelopePath = path.join(parent, "portable-metadata-repeat");
  vlab(repo, "metadata", "export", secondEnvelopePath, "--json");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(secondEnvelopePath, "manifest.json"), "utf8")),
    envelopeManifest,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(secondEnvelopePath, "objects.bundle")),
    fs.readFileSync(path.join(envelopePath, "objects.bundle")),
  );
  const incomingId = envelopeManifest.records.find(
    (record) => record.type === "landing",
  ).id;
  const conflictDestination = path.join(parent, "conflict-destination");
  git(parent, "clone", "--no-local", repo, conflictDestination);
  git(conflictDestination, "config", "user.name", "VCS Lab Test");
  git(conflictDestination, "config", "user.email", "vcs-lab@example.test");
  const conflictHead = git(conflictDestination, "rev-parse", "HEAD");
  const conflictingRecord = {
    schema: "vcs-lab.note/v1",
    records: [{
      schema: "vcs-lab.application/v1",
      type: "application",
      id: incomingId,
      originCommit: base.commit,
      originChangeId: "ch_conflicting_import",
      appliedCommit: conflictHead,
      appliedChangeId: "ch_conflicting_import",
      targetBefore: base.commit,
      relation: "same-logical-change",
      createdAt: new Date(0).toISOString(),
    }],
  };
  exec(
    "git",
    ["notes", "--ref=vcs-lab", "add", "-f", "-F", "-", conflictHead],
    conflictDestination,
    { input: `${JSON.stringify(conflictingRecord, null, 2)}\n` },
  );
  const conflictNotesBefore = git(
    conflictDestination,
    "rev-parse",
    "refs/notes/vcs-lab",
  );
  const conflictPreview = vlabResult(
    conflictDestination,
    "metadata",
    "import",
    envelopePath,
    "--dry-run",
    "--json",
  );
  assert.notEqual(conflictPreview.status, 0);
  assert.ok(conflictPreview.stdout, conflictPreview.stderr);
  assert.ok(JSON.parse(conflictPreview.stdout).summary.conflicts > 0);
  assert.equal(
    git(conflictDestination, "rev-parse", "refs/notes/vcs-lab"),
    conflictNotesBefore,
  );
  assert.equal(
    git(conflictDestination, "for-each-ref", "--format=%(refname)", "refs/vcs-lab/resolutions"),
    "",
  );

  const tamperedEnvelope = path.join(parent, "tampered-metadata");
  fs.cpSync(envelopePath, tamperedEnvelope, { recursive: true });
  fs.appendFileSync(path.join(tamperedEnvelope, "objects.bundle"), "tampered");
  const tampered = vlabResult(
    conflictDestination,
    "metadata",
    "import",
    tamperedEnvelope,
    "--dry-run",
    "--json",
  );
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /payload integrity check failed/i);

  const unrelated = path.join(parent, "unrelated");
  fs.mkdirSync(unrelated);
  git(unrelated, "init", "-b", "main");
  git(unrelated, "config", "user.name", "VCS Lab Test");
  git(unrelated, "config", "user.email", "vcs-lab@example.test");
  write(unrelated, "unrelated.txt", "unrelated\n");
  git(unrelated, "add", ".");
  git(unrelated, "commit", "-m", "unrelated root");
  const unrelatedPreview = vlabResult(
    unrelated,
    "metadata",
    "import",
    envelopePath,
    "--dry-run",
    "--json",
  );
  assert.notEqual(unrelatedPreview.status, 0);
  assert.match(unrelatedPreview.stderr, /requires a shared root commit/i);

  const destination = path.join(parent, "destination");
  git(parent, "clone", "--no-local", repo, destination);
  git(destination, "config", "core.autocrlf", "false");
  git(destination, "config", "user.name", "VCS Lab Test");
  git(destination, "config", "user.email", "vcs-lab@example.test");
  const preview = JSON.parse(
    vlab(destination, "metadata", "import", envelopePath, "--dry-run", "--json"),
  );
  assert.equal(preview.summary.applicable, true);
  assert.ok(preview.summary.addRecords > 0);
  assert.ok(["same", "fork"].includes(preview.repository.lineageRelation));

  const imported = JSON.parse(
    vlab(destination, "metadata", "import", envelopePath, "--apply", "--json"),
  );
  assert.equal(imported.applied, true);
  const repeated = JSON.parse(
    vlab(destination, "metadata", "import", envelopePath, "--apply", "--json"),
  );
  assert.equal(repeated.summary.addRecords, 0);
  assert.equal(repeated.summary.conflicts, 0);
  assert.equal(repeated.changed, false);

  const afterPlan = JSON.parse(
    vlab(destination, "merge-plan", "origin/feature", "--json"),
  );
  assert.deepEqual(afterPlan.counts, beforePlan.counts);
  assert.deepEqual(
    afterPlan.changes.map(({ changeId, status, proof }) => ({ changeId, status, proof })),
    beforePlan.changes.map(({ changeId, status, proof }) => ({ changeId, status, proof })),
  );
  const destinationCatalog = JSON.parse(vlab(destination, "resolve", "list", "--json"));
  assert.equal(destinationCatalog.length, 1);
  assert.equal(destinationCatalog[0].resultBlob, sourceCatalog[0].resultBlob);
  const destinationSpec = JSON.parse(vlab(destination, "spec", "show", "docs/spec.md", "--json"));
  assert.equal(destinationSpec.manifest.artifactId, sourceSpec.manifest.artifactId);
  assert.deepEqual(
    destinationSpec.manifest.blocks.map((block) => block.id),
    sourceSpec.manifest.blocks.map((block) => block.id),
  );

  const destinationStatus = JSON.parse(vlab(destination, "metadata", "status", "--json"));
  assert.equal(destinationStatus.scopes.sharedPortable.notes.quarantinedCount, 0);
  assert.equal(destinationStatus.scopes.sharedLocal.checkpoints.refCount, 0);
  assert.equal(destinationStatus.scopes.sharedLocal.workspaceRegistry.present, false);
  assert.equal(destinationStatus.scopes.worktreePrivate.pendingOperationCount, 0);
  assert.equal(destinationStatus.scopes.worktreePrivate.forecastCount, 0);
});
