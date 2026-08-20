import {
  assertClean,
  changeIdForCommit,
  commitMessage,
  currentHead,
  extractTrailer,
  findCommitByChangeId,
  resolveRevision,
  runGit,
} from "./git.js";
import { newId } from "./ids.js";
import { appendNote } from "./notes.js";
import { buildMergePlan } from "./merge-plan.js";
import { CliError } from "./errors.js";

function resolveChangeOrCommit(value, cwd) {
  if (value.startsWith("ch_")) {
    const commit = findCommitByChangeId(value, cwd);
    if (!commit) throw new CliError(`No commit with Change-Id '${value}' was found.`);
    return commit;
  }
  return resolveRevision(value, cwd);
}

function coveredChangeIds(ref, cwd) {
  const output = runGit(["log", ref, "--format=%B%x1e"], { cwd }).stdout;
  const ids = new Set();
  for (const message of output.split("\x1e")) {
    const id = extractTrailer(message, "Change-Id");
    if (id) ids.add(id);
    for (const match of message.matchAll(/^Absorbs:\s*(\S+)/gim)) ids.add(match[1]);
  }
  return ids;
}

export function cherryPick(value, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  assertClean(cwd);
  const originCommit = resolveChangeOrCommit(value, cwd);
  const originChangeId = changeIdForCommit(originCommit, cwd);
  const targetBefore = currentHead(cwd);
  if (!options.repeat && coveredChangeIds("HEAD", cwd).has(originChangeId)) {
    return {
      noOp: true,
      reason: "target-already-covers-change-id",
      originCommit,
      originChangeId,
      targetBefore,
    };
  }

  let appliedCommit;
  let appliedChangeId = originChangeId;
  if (options.fork) {
    const picked = runGit(["cherry-pick", "--no-commit", originCommit], {
      cwd,
      allowFailure: true,
    });
    if (!picked.ok) {
      throw new CliError("Cherry-pick produced conflicts.", { details: picked.output });
    }
    appliedChangeId = newId("ch");
    const originalSubject = runGit(
      ["show", "-s", "--format=%s", originCommit],
      { cwd },
    ).stdout;
    const message = [
      originalSubject,
      "",
      `Change-Id: ${appliedChangeId}`,
      `Derived-From: ${originChangeId}`,
      `Origin-Commit: ${originCommit}`,
    ].join("\n");
    runGit(["commit", "-m", message], { cwd });
    appliedCommit = currentHead(cwd);
  } else {
    const picked = runGit(["cherry-pick", "-x", originCommit], {
      cwd,
      allowFailure: true,
    });
    if (!picked.ok) {
      throw new CliError("Cherry-pick produced conflicts.", { details: picked.output });
    }
    appliedCommit = currentHead(cwd);
  }

  const application = {
    schema: "vcs-lab.application/v1",
    type: "application",
    id: newId("apply"),
    originCommit,
    originChangeId,
    appliedCommit,
    appliedChangeId,
    targetBefore,
    relation: options.fork ? "derived-fork" : "same-logical-change",
    createdAt: new Date().toISOString(),
  };
  appendNote(appliedCommit, application, cwd);
  return application;
}

export function reconcile(sourceRef, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  assertClean(cwd);
  const plan = buildMergePlan(sourceRef, cwd);
  const candidates = plan.changes.filter(
    (change) => change.status === "candidate-equivalent",
  );
  if (candidates.length && !options.acceptCandidates) {
    throw new CliError(
      "The plan contains heuristic patch-equivalence candidates.",
      {
        details:
          "Review 'vlab merge-plan' and rerun with --accept-candidates to treat them as already applied.",
      },
    );
  }

  const selected = plan.changes.filter((change) => change.status === "new");
  const targetBefore = plan.targetHead;
  const applied = [];
  for (const change of selected) {
    const result = runGit(["cherry-pick", "-x", change.commit], {
      cwd,
      allowFailure: true,
    });
    if (!result.ok) {
      throw new CliError(
        `Reconciliation stopped while applying ${change.shortCommit}.`,
        {
          details:
            `${result.output}\nResolve with Git and continue manually, or run 'git cherry-pick --abort'.`,
        },
      );
    }
    const appliedCommit = currentHead(cwd);
    applied.push({ sourceCommit: change.commit, appliedCommit, changeId: change.changeId });
    appendNote(
      appliedCommit,
      {
        schema: "vcs-lab.application/v1",
        type: "application",
        id: newId("apply"),
        originCommit: change.commit,
        originChangeId: change.changeId,
        appliedCommit,
        appliedChangeId: changeIdForCommit(appliedCommit, cwd),
        targetBefore,
        relation: "causal-reconciliation",
        createdAt: new Date().toISOString(),
      },
      cwd,
    );
  }

  const attachedTo = currentHead(cwd);
  const resultTree = runGit(["rev-parse", `${attachedTo}^{tree}`], { cwd }).stdout;
  const receipt = {
    schema: "vcs-lab.reconciliation/v2",
    type: "reconciliation",
    id: newId("reconcile"),
    sourceRef,
    sourceHead: plan.sourceHead,
    targetBefore,
    resultCommit: attachedTo,
    absorbedCommits: plan.changes
      .filter((change) => change.status !== "candidate-equivalent" || options.acceptCandidates)
      .map((change) => change.commit),
    absorbedChanges: plan.changes
      .filter((change) => change.status !== "candidate-equivalent" || options.acceptCandidates)
      .map((change) => change.changeId),
    applied,
    targetTreeBefore: plan.targetTree,
    sourceTree: plan.sourceTree,
    resultTree,
    exactStateEqualityBefore: plan.exactStateEquality,
    exactStateEqualityAfter: resultTree === plan.sourceTree,
    createdAt: new Date().toISOString(),
  };
  appendNote(attachedTo, receipt, cwd);
  return { plan, receipt };
}

export function createCommit(message, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const changeId = options.changeId ?? newId("ch");
  const args = ["commit"];
  if (options.all) args.push("--all");
  if (options.allowEmpty) args.push("--allow-empty");
  args.push("-m", `${message}\n\nChange-Id: ${changeId}`);
  runGit(args, { cwd });
  const commit = currentHead(cwd);
  return { commit, changeId, message: commitMessage(commit, cwd) };
}
