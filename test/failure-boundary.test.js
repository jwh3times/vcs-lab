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
  const repo = conflictOnSharedFile(makeReconcilable());

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

/**
 * A repository positioned on `feature` for a causal rebase that runs to
 * completion, so the operation reaches the publication path these tests
 * interrupt. A rebase has strictly more at stake than a reconciliation: by the
 * time publication starts, the branch ref has already moved.
 */
function makeRebasable() {
  const repo = makeReconcilable();
  git(repo, "switch", "feature");
  return repo;
}

/**
 * Make the source and target edit the same file, so the next operation pauses
 * on a real conflict with real cherry-pick state for an out-of-band actor to
 * reach past vlab and drive directly.
 */
function conflictOnSharedFile(repo) {
  git(repo, "switch", "feature");
  write(repo, "a.txt", "feature edits the shared file\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "feature touches a.txt");
  git(repo, "switch", "main");
  write(repo, "a.txt", "main edits the shared file\n");
  git(repo, "add", "-A");
  vlab(repo, "commit", "-m", "main touches a.txt");
  return repo;
}

const rebaseJournalPath = (repo) => path.join(repo, ".git", "vcs-lab", "rebase.json");

test("an interrupted rebase publication is recoverable and never duplicates a record", () => {
  for (const point of [
    "rebase:before-publish",
    "rebase:before-receipt",
    "rebase:before-clear",
  ]) {
    const repo = makeRebasable();
    const before = git(repo, "rev-parse", "feature");
    const interrupted = vlabResult(repo, ["rebase", "main", "--json"], {
      VLAB_TEST_FAULT: point,
    });
    assert.equal(
      interrupted.status,
      FAULT_EXIT_CODE,
      `${point}: the fault must stop the process, not fail normally`,
    );

    // What distinguishes this from the reconciliation case: the branch has
    // already been moved to the rewritten history before any record exists to
    // explain it. The journal is the only thing that can account for the move.
    assert.notEqual(
      git(repo, "rev-parse", "feature"),
      before,
      `${point}: the fixture must interrupt after the branch ref moved`,
    );
    assert.ok(fs.existsSync(rebaseJournalPath(repo)), `${point}: the journal must survive`);
    const status = JSON.parse(vlab(repo, "rebase", "--status", "--json"));
    assert.equal(status.active, true, `${point}: the operation is still reported as pending`);

    const published = receipts(repo);
    const ids = published.map((record) => record.id);
    assert.equal(
      new Set(ids).size,
      ids.length,
      `${point}: an interruption must never duplicate a record`,
    );
    if (point === "rebase:before-publish") {
      assert.equal(published.length, 0, "nothing is published before the publication loop");
    }
    if (point === "rebase:before-receipt") {
      assert.deepEqual(
        published.map((record) => record.type),
        ["rebase-application"],
        "application records land before the operation receipt",
      );
    }
    if (point === "rebase:before-clear") {
      assert.ok(
        published.some((record) => record.type === "rebase"),
        "the rebase receipt is published before the journal is cleared",
      );
    }

    const resumed = vlabResult(repo, ["rebase", "--continue", "--json"]);
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

test("aborting an interrupted rebase restores the branch and leaves no effective coverage", () => {
  // The worst case for a rebase: the process died after both records were
  // published but before the journal was cleared, so an abort has to roll a
  // moved branch ref back out from under records that already exist.
  const repo = makeRebasable();
  const before = git(repo, "rev-parse", "feature");
  const interrupted = vlabResult(repo, ["rebase", "main", "--json"], {
    VLAB_TEST_FAULT: "rebase:before-clear",
  });
  assert.equal(interrupted.status, FAULT_EXIT_CODE);
  assert.equal(receipts(repo).length, 2, "both records were published before the fault");
  assert.notEqual(git(repo, "rev-parse", "feature"), before, "the branch had already moved");

  const aborted = JSON.parse(vlab(repo, "rebase", "--abort", "--json"));
  assert.equal(aborted.aborted, true);
  assert.equal(
    git(repo, "rev-parse", "feature"),
    before,
    "abort restores the branch to its pre-rebase tip",
  );
  assert.equal(fs.existsSync(rebaseJournalPath(repo)), false, "abort clears the journal");

  // As with reconciliation, the records survive on the notes ref rather than
  // being rewritten away, and carry no weight because the commits they are
  // attached to are no longer reachable.
  const survivors = receipts(repo);
  assert.equal(survivors.length, 2, "published records are not rewritten away by an abort");
  for (const record of survivors) {
    const reachable = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", record.attachedTo, "feature"],
      { cwd: repo, encoding: "utf8" },
    );
    assert.notEqual(
      reachable.status,
      0,
      "the surviving records hang off commits the abort made unreachable",
    );
  }

  git(repo, "switch", "main");
  const plan = JSON.parse(vlab(repo, "merge-plan", "feature", "--json"));
  assert.equal(plan.counts.covered, 0, "an orphaned rebase record must not cover anything");
  assert.equal(plan.counts.new, 1);
  assert.deepEqual(plan.reachableReceipts, [], "no receipt is admitted as reachable");
});

test("out-of-band continue and skip during a paused reconciliation fail closed", () => {
  // The dangerous shape is not the out-of-band abort already covered above but
  // an out-of-band *advance*: Git commits the resolution itself, so the work
  // looks finished. vlab must refuse to certify a commit it never saw resolved,
  // because a receipt is a claim about how the content was reached.
  for (const action of ["continue", "skip"]) {
    const repo = conflictOnSharedFile(makeReconcilable());
    const conflicted = vlabResult(repo, ["reconcile", "feature", "--json"]);
    assert.notEqual(conflicted.status, 0, "the fixture must pause on a conflict");
    const notesBefore = notesRef(repo);

    if (action === "continue") {
      write(repo, "a.txt", "resolved out of band\n");
      git(repo, "add", "a.txt");
      const advanced = spawnSync("git", ["cherry-pick", "--continue"], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, GIT_EDITOR: "true" },
      });
      assert.equal(advanced.status, 0, "the out-of-band continue itself succeeds");
    } else {
      assert.equal(
        spawnSync("git", ["cherry-pick", "--skip"], { cwd: repo, encoding: "utf8" }).status,
        0,
        "the out-of-band skip itself succeeds",
      );
    }

    const resumed = vlabResult(repo, ["reconcile", "--continue", "--json"]);
    assert.notEqual(resumed.status, 0, `vlab must not publish after an out-of-band ${action}`);
    assert.match(resumed.stderr, /^vlab: /m, "the refusal is a domain diagnostic");
    assert.equal(
      notesRef(repo),
      notesBefore,
      `no receipt is published after an out-of-band ${action}`,
    );
    assert.equal(receipts(repo).length, 0, "nothing was certified");
  }
});

test("out-of-band Git actions during a paused rebase fail closed and stay recoverable", () => {
  // A paused rebase is the worst place to reach past vlab: the branch ref is
  // mid-move, so an out-of-band action can leave Git's idea of the sequence and
  // the journal's idea of it disagreeing about which commit is being applied.
  for (const action of ["continue", "skip", "abort"]) {
    const repo = conflictOnSharedFile(makeReconcilable());
    git(repo, "switch", "feature");
    const original = git(repo, "rev-parse", "feature");
    const conflicted = vlabResult(repo, ["rebase", "main", "--json"]);
    assert.notEqual(conflicted.status, 0, "the fixture must pause on a conflict");
    assert.ok(fs.existsSync(rebaseJournalPath(repo)), "a paused rebase keeps its journal");
    const notesBefore = notesRef(repo);

    if (action === "continue") {
      write(repo, "a.txt", "resolved out of band\n");
      git(repo, "add", "a.txt");
      assert.equal(
        spawnSync("git", ["cherry-pick", "--continue"], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, GIT_EDITOR: "true" },
        }).status,
        0,
        "the out-of-band continue itself succeeds",
      );
    } else {
      assert.equal(
        spawnSync("git", ["cherry-pick", `--${action}`], { cwd: repo, encoding: "utf8" }).status,
        0,
        `the out-of-band ${action} itself succeeds`,
      );
    }

    const resumed = vlabResult(repo, ["rebase", "--continue", "--json"]);
    assert.notEqual(resumed.status, 0, `vlab must not publish after an out-of-band ${action}`);
    assert.match(
      resumed.stderr,
      /does not match the causal rebase journal/,
      "the refusal names the disagreement rather than failing generically",
    );
    assert.equal(notesRef(repo), notesBefore, "no receipt is published while recovering");

    // Refusing is only half of failing closed: the operation must still be
    // recoverable afterwards, or an out-of-band action would strand the branch
    // partway through a rewrite.
    const aborted = JSON.parse(vlab(repo, "rebase", "--abort", "--json"));
    assert.equal(aborted.aborted, true);
    assert.equal(
      git(repo, "rev-parse", "feature"),
      original,
      `vlab's own abort recovers the branch after an out-of-band ${action}`,
    );
    assert.equal(fs.existsSync(rebaseJournalPath(repo)), false);
    assert.equal(notesRef(repo), notesBefore, "aborting publishes nothing");
  }
});

test("a journal never claims more progress than Git actually made", () => {
  // The journal is written after Git has already committed the pick, so an
  // interruption in between leaves Git one commit ahead of the journal. That
  // asymmetry is deliberate and it is the safe direction: a journal that
  // under-reports causes an abort to roll back work nobody recorded, while a
  // journal that over-reported would have the operation resume past a commit
  // that does not exist. This pins the direction.
  for (const [command, point, journal, ref] of [
    ["reconcile", "reconcile:before-journal-advance", journalPath, "HEAD"],
    ["rebase", "rebase:before-journal-advance", rebaseJournalPath, "feature"],
  ]) {
    const repo = command === "rebase" ? makeRebasable() : makeReconcilable();
    const target = command === "rebase" ? "main" : "feature";
    const before = git(repo, "rev-parse", ref);

    const interrupted = vlabResult(repo, [command, target, "--json"], {
      VLAB_TEST_FAULT: point,
    });
    assert.equal(interrupted.status, FAULT_EXIT_CODE);

    // Git moved: the pick was committed before the fault.
    assert.notEqual(
      git(repo, "rev-parse", ref),
      before,
      `${command}: the fixture must interrupt after Git committed the pick`,
    );

    // The journal did not. It still describes an application in flight rather
    // than a completed one, which is the honest reading of what happened.
    const state = JSON.parse(fs.readFileSync(journal(repo), "utf8"));
    assert.equal(state.state, "applying", `${command}: the journal says it was mid-application`);
    assert.equal(state.nextIndex, 0, `${command}: no application was recorded`);
    assert.equal(state.applied.length, 0);
    assert.notEqual(state.current, null, "the in-flight change is still named");

    // The atomic write leaves no torn file and no debris behind it.
    const strays = fs
      .readdirSync(path.join(repo, ".git", "vcs-lab"))
      .filter((entry) => entry.includes(".tmp-"));
    assert.deepEqual(strays, [], `${command}: the journal write leaves no temporary file`);

    // Continuing is refused rather than guessed at, and nothing is certified.
    const resumed = vlabResult(repo, [command, "--continue", "--json"]);
    assert.notEqual(resumed.status, 0, `${command}: a torn journal must not be resumed`);
    assert.match(resumed.stderr, /^vlab: /m, "the refusal is a domain diagnostic");
    assert.equal(receipts(repo).length, 0, `${command}: nothing was published`);

    // And the state is not a trap: abort still recovers it completely.
    assert.equal(JSON.parse(vlab(repo, command, "--abort", "--json")).aborted, true);
    assert.equal(git(repo, "rev-parse", ref), before, `${command}: abort restores the tip`);
    assert.equal(fs.existsSync(journal(repo)), false);
    assert.equal(git(repo, "status", "--porcelain"), "", "the worktree is left clean");
  }
});

test("an interrupted abort can be completed by running it again", () => {
  // The cleanup edge. Abort restores the history first and clears the journal
  // second, so an interruption between them leaves a repository that is
  // already rolled back while still advertising a pending operation. If abort
  // were not idempotent across that point the operation could neither be
  // continued nor abandoned.
  for (const [command, journal, ref] of [
    ["reconcile", journalPath, "HEAD"],
    ["rebase", rebaseJournalPath, "feature"],
  ]) {
    const repo = command === "rebase" ? makeRebasable() : makeReconcilable();
    const target = command === "rebase" ? "main" : "feature";
    const before = git(repo, "rev-parse", ref);

    // Get into the worst state first: everything published, journal uncleared.
    vlabResult(repo, [command, target, "--json"], {
      VLAB_TEST_FAULT: `${command}:before-clear`,
    });
    assert.equal(receipts(repo).length, 2, "both records were published");

    const interruptedAbort = vlabResult(repo, [command, "--abort", "--json"], {
      VLAB_TEST_FAULT: `${command}:abort-before-clear`,
    });
    assert.equal(interruptedAbort.status, FAULT_EXIT_CODE);
    assert.equal(
      git(repo, "rev-parse", ref),
      before,
      `${command}: the history was restored before the fault`,
    );
    assert.ok(
      fs.existsSync(journal(repo)),
      `${command}: the journal is what the interrupted abort had left to clear`,
    );
    assert.equal(
      JSON.parse(vlab(repo, command, "--status", "--json")).active,
      true,
      "the operation still advertises itself as pending",
    );

    // Running abort again finishes the job rather than failing on a repository
    // that no longer needs the part that already succeeded.
    const retried = JSON.parse(vlab(repo, command, "--abort", "--json"));
    assert.equal(retried.aborted, true, `${command}: abort is idempotent`);
    assert.equal(git(repo, "rev-parse", ref), before);
    assert.equal(fs.existsSync(journal(repo)), false, "the retry clears the journal");
    assert.equal(git(repo, "status", "--porcelain"), "", "the worktree is left clean");
    assert.equal(
      JSON.parse(vlab(repo, command, "--status", "--json")).active,
      false,
      "no operation is pending afterwards",
    );
  }
});
