import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { FAULT_EXIT_CODE } from "../src/faults.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectRoot, "bin", "vlab.js");

const created = [];
after(() => {
  for (const directory of created) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function exec(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...options,
  }).trim();
}

const git = (cwd, ...args) => exec("git", args, cwd);
const vlab = (cwd, ...args) => exec(process.execPath, [cli, ...args], cwd);

function vlabResult(cwd, args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
}

function write(repo, relative, content) {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * A repository whose reconciliation runs to completion without conflicting:
 * the source and target touch different files, so the operation reaches the
 * publication path, which is the stretch these tests interrupt.
 */
function makeReconcilable() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-lab-fault-"));
  created.push(parent);
  const repo = path.join(parent, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "config", "core.eol", "lf");
  git(repo, "config", "user.name", "VCS Lab Fault Test");
  git(repo, "config", "user.email", "vcs-lab-fault@example.invalid");
  write(repo, "a.txt", "base\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "base");
  vlab(repo, "init");
  git(repo, "switch", "-c", "feature");
  write(repo, "f.txt", "feature\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "feature one");
  git(repo, "switch", "main");
  write(repo, "m.txt", "main\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "main moves");
  return repo;
}

const receipts = (repo) => JSON.parse(vlab(repo, "receipts", "--json"));
const journalPath = (repo) => path.join(repo, ".git", "vcs-lab", "reconciliation.json");
const notesRef = (repo) =>
  spawnSync("git", ["rev-parse", "refs/notes/vcs-lab"], { cwd: repo, encoding: "utf8" })
    .stdout.trim();

test("an interrupted publication leaves a recoverable journal and no duplicate records", () => {
  for (const point of [
    "reconcile:before-publish",
    "reconcile:before-receipt",
    "reconcile:before-clear",
  ]) {
    const repo = makeReconcilable();
    const interrupted = vlabResult(repo, ["reconcile", "feature", "--json"], {
      VLAB_TEST_FAULT: point,
    });
    assert.equal(
      interrupted.status,
      FAULT_EXIT_CODE,
      `${point}: the fault must stop the process, not fail normally`,
    );

    // The journal always survives, which is what makes the operation
    // recoverable at all rather than merely broken.
    assert.ok(fs.existsSync(journalPath(repo)), `${point}: the journal must survive`);
    const status = JSON.parse(vlab(repo, "reconcile", "--status", "--json"));
    assert.equal(status.active, true, `${point}: the operation is still reported as pending`);

    const published = receipts(repo);
    const ids = published.map((record) => record.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${point}: an interruption must never duplicate a record`,
    );
    if (point === "reconcile:before-publish") {
      assert.equal(published.length, 0, "nothing is published before the publication loop");
    }
    if (point === "reconcile:before-clear") {
      assert.ok(
        published.some((record) => record.type === "reconciliation"),
        "the reconciliation receipt is published before the journal is cleared",
      );
    }

    // Continuing must not re-run publication over records that already exist.
    const resumed = vlabResult(repo, ["reconcile", "--continue", "--json"]);
    const afterResume = receipts(repo).map((record) => record.id);
    assert.equal(
      new Set(afterResume).size,
      afterResume.length,
      `${point}: --continue must not duplicate published records`,
    );
    if (resumed.status !== 0) {
      assert.match(
        resumed.stderr,
        /^vlab: /m,
        `${point}: a refused continue must be a domain diagnostic`,
      );
    }
  }
});

test("aborting an interrupted publication restores the head and leaves no effective coverage", () => {
  // The damaging case: the process died after both receipts were published but
  // before the journal was cleared, so an abort rolls the target back out from
  // under records that already exist.
  const repo = makeReconcilable();
  const before = git(repo, "rev-parse", "HEAD");
  const interrupted = vlabResult(repo, ["reconcile", "feature", "--json"], {
    VLAB_TEST_FAULT: "reconcile:before-clear",
  });
  assert.equal(interrupted.status, FAULT_EXIT_CODE);
  assert.equal(receipts(repo).length, 2, "both receipts were published before the fault");

  const aborted = JSON.parse(vlab(repo, "reconcile", "--abort", "--json"));
  assert.equal(aborted.aborted, true);
  assert.equal(git(repo, "rev-parse", "HEAD"), before, "abort restores the starting commit");
  assert.equal(fs.existsSync(journalPath(repo)), false, "abort clears the journal");

  // The receipts survive on the notes ref: nothing rewrites a peer-visible ref
  // to erase history. What matters is that they carry no weight, because the
  // commits they are attached to are no longer reachable from the target and
  // FR-PLAN-05 admits only reachable receipts as evidence.
  const survivors = receipts(repo);
  assert.equal(survivors.length, 2, "published records are not rewritten away by an abort");
  for (const record of survivors) {
    const reachable = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", record.attachedTo, "HEAD"],
      { cwd: repo, encoding: "utf8" },
    );
    assert.notEqual(
      reachable.status,
      0,
      "the surviving records hang off commits the abort made unreachable",
    );
  }

  // The property that actually matters: no false coverage survives.
  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.covered, 0, "an orphaned receipt must not cover anything");
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.changes[0].proof, null);
  assert.deepEqual(plan.reachableReceipts, [], "no receipt is admitted as reachable");

  // And the proof bundle a third party would verify says the same, from
  // evidence rather than from the planner's word.
  const bundle = JSON.parse(vlab(repo, "proof-bundle", "feature"));
  assert.equal(bundle.evidence.receipts.length, 0, "orphaned receipts are not evidence");
  assert.equal(bundle.changes[0].status, "new");
});

test("out-of-band Git actions during a paused operation fail closed", () => {
  // A conflicted reconciliation leaves real cherry-pick state. A user who
  // reaches past vlab and drives Git directly must not be able to make vlab
  // publish a receipt for work it never verified.
  const repo = makeReconcilable();
  git(repo, "switch", "feature");
  write(repo, "a.txt", "feature edits the shared file\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "feature touches a.txt");
  git(repo, "switch", "main");
  write(repo, "a.txt", "main edits the shared file\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "main touches a.txt");

  const conflicted = vlabResult(repo, ["reconcile", "feature", "--json"]);
  assert.notEqual(conflicted.status, 0, "the fixture must pause on a conflict");
  assert.ok(fs.existsSync(journalPath(repo)), "a paused operation keeps its journal");
  const notesBefore = notesRef(repo);

  // Abort the cherry-pick behind vlab's back, leaving the journal claiming a
  // conflict that Git no longer has.
  const outOfBand = spawnSync("git", ["cherry-pick", "--abort"], { cwd: repo, encoding: "utf8" });
  assert.equal(outOfBand.status, 0, "the out-of-band abort itself succeeds");

  const resumed = vlabResult(repo, ["reconcile", "--continue", "--json"]);
  assert.notEqual(resumed.status, 0, "vlab must not publish after an out-of-band abort");
  assert.match(resumed.stderr, /^vlab: /m, "the refusal is a domain diagnostic");
  assert.equal(
    notesRef(repo),
    notesBefore,
    "no receipt is published while recovering from an out-of-band action",
  );

  // The operation stays recoverable through vlab's own abort.
  const aborted = JSON.parse(vlab(repo, "reconcile", "--abort", "--json"));
  assert.equal(aborted.aborted, true);
  assert.equal(fs.existsSync(journalPath(repo)), false);
  assert.equal(notesRef(repo), notesBefore, "aborting publishes nothing");
});
