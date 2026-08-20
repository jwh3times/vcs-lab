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
    "vcs-lab 0.6.0",
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

  const forecast = JSON.parse(vlab(repo, "forecast", "feature", "--json"));
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
  assert.equal(git(repo, "rev-parse", "HEAD"), before.head);
  assert.equal(git(repo, "status", "--porcelain=v1"), before.status);

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

test("doctor benchmarks Git probes and trace mode reports subprocess timings", (t) => {
  const { repo } = makeRepo(t);
  write(repo, "base.txt", "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-m", "base");
  const doctor = JSON.parse(
    vlab(repo, "doctor", "--benchmark", "--samples", "5", "--warmup", "2"),
  );
  assert.equal(doctor.ok, true);
  assert.equal(doctor.benchmark.length, 4);
  assert.ok(doctor.benchmark.every((probe) => probe.samplesMs.length === 5));
  assert.ok(doctor.benchmark.every((probe) => probe.warmup === 2));
  assert.ok(doctor.benchmark.every((probe) => probe.p95Ms >= probe.medianMs));

  const traced = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", VLAB_TRACE: "1" },
  });
  assert.equal(traced.status, 0);
  assert.match(traced.stderr, /\[vlab trace\].*git --version/);
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

test("workspace forecast compares committed agent heads without touching drafts", (t) => {
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
});
