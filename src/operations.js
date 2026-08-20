import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  assertClean,
  changeIdForCommit,
  commitMessage,
  currentHead,
  extractTrailer,
  findCommitByChangeId,
  repoContext,
  resolveRevision,
  runGit,
  treeId,
} from "./git.js";
import { newId } from "./ids.js";
import { appendNote } from "./notes.js";
import { buildMergePlan } from "./merge-plan.js";
import { CliError } from "./errors.js";
import {
  cherryPickHead,
  clearReconciliationState,
  mergeMessagePath,
  readReconciliationState,
  unmergedPaths,
  writeReconciliationState,
} from "./reconcile-state.js";
import {
  captureConflictDescriptors,
  captureResolutionOutcomes,
  materializeResolutionCandidate,
  publishResolution,
} from "./resolutions.js";
import { forecastForPlan } from "./forecasts.js";

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

function requirePendingReconciliation(cwd) {
  const operation = readReconciliationState(cwd);
  if (!operation) {
    throw new CliError("No reconciliation is in progress in this worktree.");
  }
  return operation;
}

function applicationRecord(operation, change, appliedCommit, relation, cwd) {
  return {
    schema: "vcs-lab.application/v3",
    type: "application",
    id: newId("apply"),
    reconciliationOperation: operation.id,
    originCommit: change.commit,
    originChangeId: change.changeId,
    appliedCommit,
    appliedChangeId: changeIdForCommit(appliedCommit, cwd),
    targetBefore: operation.current.targetBefore,
    sourceTree: treeId(change.commit, cwd),
    resultTree: treeId(appliedCommit, cwd),
    relation,
    forecastId: operation.forecastId ?? null,
    conflictedPaths: operation.current.conflictedPaths ?? [],
    resolutions: operation.current.resolutionOutcomes ?? [],
    createdAt: new Date().toISOString(),
  };
}

function recordSuccessfulApplication(operation, relation, cwd) {
  const change = operation.queue[operation.nextIndex];
  const appliedCommit = currentHead(cwd);
  const application = applicationRecord(
    operation,
    change,
    appliedCommit,
    relation,
    cwd,
  );
  operation.applied.push(application);
  operation.nextIndex += 1;
  operation.current = null;
  operation.state = "running";
  writeReconciliationState(operation, cwd);
  return application;
}

function finalizeReconciliation(operation, cwd) {
  const attachedTo = currentHead(cwd);
  const resultTree = treeId(attachedTo, cwd);
  const predictedTree = operation.forecastApproval?.predictedResultTree;
  if (predictedTree && predictedTree !== resultTree) {
    operation.state = "forecast-mismatch";
    writeReconciliationState(operation, cwd);
    throw new CliError(
      `Reconciliation result does not match forecast '${operation.forecastId}'.`,
      {
        details: [
          `Forecast tree: ${predictedTree}`,
          `Actual tree:   ${resultTree}`,
          "Run 'vlab reconcile --abort' and generate a new forecast.",
        ].join("\n"),
      },
    );
  }
  const forkedOrigins = new Set(
    operation.applied
      .filter((application) => application.relation === "contextual-fork")
      .map((application) => application.originCommit),
  );
  const covered = operation.plan.changes.filter(
    (change) =>
      !forkedOrigins.has(change.commit) &&
      (change.status !== "candidate-equivalent" || operation.acceptCandidates),
  );
  const applied = operation.applied.map((application) => ({
    sourceCommit: application.originCommit,
    appliedCommit: application.appliedCommit,
    changeId: application.appliedChangeId,
    relation: application.relation,
    conflictedPaths: application.conflictedPaths,
    resolutions: application.resolutions,
  }));
  const receipt = {
    schema: "vcs-lab.reconciliation/v5",
    type: "reconciliation",
    id: newId("reconcile"),
    operationId: operation.id,
    forecastId: operation.forecastId ?? null,
    sourceRef: operation.sourceRef,
    sourceHead: operation.sourceHead,
    targetBefore: operation.targetBefore,
    resultCommit: attachedTo,
    absorbedCommits: covered.map((change) => change.commit),
    absorbedChanges: covered.map((change) => change.changeId),
    applied,
    forkedSourceCommits: [...forkedOrigins],
    targetTreeBefore: operation.plan.targetTree,
    sourceTree: operation.plan.sourceTree,
    resultTree,
    exactStateEqualityBefore: operation.plan.exactStateEquality,
    exactStateEqualityAfter: resultTree === operation.plan.sourceTree,
    timings: {
      activeApplicationMs: Number(
        (operation.timings?.activeApplicationMs ?? 0).toFixed(2),
      ),
      elapsedWallMs: Date.now() - Date.parse(operation.startedAt),
    },
    startedAt: operation.startedAt,
    createdAt: new Date().toISOString(),
  };

  for (const application of operation.applied) {
    for (const outcome of application.resolutions ?? []) {
      publishResolution(outcome, application, cwd);
    }
    appendNote(application.appliedCommit, application, cwd);
  }
  appendNote(attachedTo, receipt, cwd);
  clearReconciliationState(cwd);
  return { operationId: operation.id, plan: operation.plan, receipt };
}

function conflictError(operation, result) {
  const change = operation.queue[operation.nextIndex];
  const paths = operation.current.conflictedPaths;
  const pathSummary = paths.length
    ? `\nConflicted paths: ${paths.join(", ")}`
    : "";
  const suggestionCount = (operation.current.conflicts ?? []).reduce(
    (count, conflict) => count + conflict.candidates.length,
    0,
  );
  const suggestion = suggestionCount
    ? `${suggestionCount} prior resolution candidate${suggestionCount === 1 ? "" : "s"} found. Run 'vlab resolve status'.`
    : "No exact prior resolution was found.";
  return new CliError(
    `Reconciliation paused while applying ${change.shortCommit}.`,
    {
      details: [
        result.output,
        pathSummary,
        suggestion,
        "Resolve and stage the files, then run 'vlab reconcile --continue'.",
        "Run 'vlab reconcile --status' for details or 'vlab reconcile --abort' to restore the starting state.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );
}

function addActiveDuration(operation, phaseStarted) {
  operation.timings ??= { activeApplicationMs: 0 };
  operation.timings.activeApplicationMs += performance.now() - phaseStarted;
}

function forecastResolutionChoices(operation, change, conflicts) {
  if (!operation.forecastApproval) return null;
  const approvals = operation.forecastApproval.approvedResolutions.filter(
    (approval) => approval.sourceCommit === change.commit,
  );
  if (approvals.length === 0) return null;
  if (approvals.length !== conflicts.length) {
    throw new CliError(
      `Forecast '${operation.forecastId}' no longer matches the current conflicts.`,
      { details: "Abort and generate a new forecast before batch application." },
    );
  }
  return conflicts.map((conflict) => {
    const approval = approvals.find(
      (item) =>
        item.path === conflict.path && item.signature === conflict.signature,
    );
    const candidate = approval
      ? conflict.candidates.find(
          (item) =>
            item.id === approval.resolutionId &&
            item.resultBlob === approval.resultBlob,
        )
      : null;
    if (!approval || !candidate) {
      throw new CliError(
        `Forecast '${operation.forecastId}' no longer matches '${conflict.path}'.`,
        { details: "Abort and generate a new forecast before batch application." },
      );
    }
    return { conflict, candidate };
  });
}

function applyForecastResolutions(operation, change, cwd) {
  const choices = forecastResolutionChoices(
    operation,
    change,
    operation.current.conflicts ?? [],
  );
  if (!choices) return false;
  for (const { conflict, candidate } of choices) {
    materializeResolutionCandidate(conflict, candidate, cwd);
    conflict.selectedResolutionId = candidate.id;
    conflict.decisionOverride = null;
    conflict.selectionMethod = "forecast-batch";
    conflict.suggestionAppliedAt = new Date().toISOString();
  }
  operation.current.resolutionOutcomes = captureResolutionOutcomes(
    operation.current.conflicts,
    cwd,
  );
  writeReconciliationState(operation, cwd);
  const continued = runGit(
    ["-c", "core.editor=true", "cherry-pick", "--continue"],
    { cwd, allowFailure: true },
  );
  if (!continued.ok) {
    throw new CliError("Git could not apply the forecasted resolutions.", {
      details: continued.output,
    });
  }
  recordSuccessfulApplication(operation, "contextual-application", cwd);
  return true;
}

function runReconciliationQueue(operation, cwd, phaseStarted = performance.now()) {
  let phaseRecorded = false;
  const finishPhase = (persist) => {
    if (phaseRecorded) return;
    addActiveDuration(operation, phaseStarted);
    phaseRecorded = true;
    if (persist) writeReconciliationState(operation, cwd);
  };
  try {
    while (operation.nextIndex < operation.queue.length) {
      const change = operation.queue[operation.nextIndex];
      operation.state = "applying";
      operation.current = {
        sourceCommit: change.commit,
        sourceChangeId: change.changeId,
        targetBefore: currentHead(cwd),
        conflictedPaths: [],
        startedAt: new Date().toISOString(),
      };
      writeReconciliationState(operation, cwd);

      const result = runGit(["cherry-pick", "-x", change.commit], {
        cwd,
        allowFailure: true,
      });
      if (!result.ok) {
        operation.current.conflictedPaths = unmergedPaths(cwd);
        operation.current.conflicts = captureConflictDescriptors(
          operation.current.conflictedPaths,
          cwd,
        );
        operation.current.gitOutput = result.output;
        operation.state = operation.current.conflictedPaths.length
          ? "conflicted"
          : "blocked";
        if (
          operation.current.conflictedPaths.length &&
          applyForecastResolutions(operation, change, cwd)
        ) {
          continue;
        }
        finishPhase(false);
        writeReconciliationState(operation, cwd);
        throw conflictError(operation, result);
      }
      recordSuccessfulApplication(operation, "causal-reconciliation", cwd);
    }
    finishPhase(false);
    return finalizeReconciliation(operation, cwd);
  } catch (error) {
    finishPhase(true);
    throw error;
  }
}

function startOperation(sourceRef, plan, options, cwd) {
  const context = repoContext(cwd);
  return {
    schema: "vcs-lab.reconciliation-operation/v3",
    id: newId("reconcile_op"),
    state: "running",
    worktree: context.root,
    sourceRef,
    sourceHead: plan.sourceHead,
    targetBefore: plan.targetHead,
    acceptCandidates: Boolean(options.acceptCandidates),
    forecastId: options.forecast?.id ?? null,
    forecastApproval: options.forecast
      ? {
          id: options.forecast.id,
          planFingerprint: options.forecast.planFingerprint,
          approvedResolutions: options.forecast.approvedResolutions,
          status: options.forecast.status,
          predictedResultTree: options.forecast.predictedResultTree,
        }
      : null,
    plan,
    queue: plan.changes.filter((change) => change.status === "new"),
    nextIndex: 0,
    applied: [],
    current: null,
    startedAt: new Date().toISOString(),
    timings: { activeApplicationMs: 0 },
    updatedAt: new Date().toISOString(),
  };
}

export function reconcile(sourceRef, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (readReconciliationState(cwd)) {
    throw new CliError(
      "A reconciliation is already in progress in this worktree.",
      { details: "Run 'vlab reconcile --status', '--continue', or '--abort'." },
    );
  }
  assertClean(cwd);
  const plan = buildMergePlan(sourceRef, cwd);
  const forecast = options.forecastId
    ? forecastForPlan(options.forecastId, plan, cwd)
    : null;
  const acceptCandidates = Boolean(
    options.acceptCandidates || forecast?.acceptCandidates,
  );
  const candidates = plan.changes.filter(
    (change) => change.status === "candidate-equivalent",
  );
  if (candidates.length && !acceptCandidates) {
    throw new CliError(
      "The plan contains heuristic patch-equivalence candidates.",
      {
        details:
          "Review 'vlab merge-plan' and rerun with --accept-candidates to treat them as already applied.",
      },
    );
  }

  const operation = startOperation(
    sourceRef,
    plan,
    { ...options, acceptCandidates, forecast },
    cwd,
  );
  writeReconciliationState(operation, cwd);
  return runReconciliationQueue(operation, cwd, performance.now());
}

export function reconciliationStatus(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = readReconciliationState(cwd);
  if (!operation) return { active: false, state: "idle" };
  return {
    active: true,
    operationId: operation.id,
    state: operation.state,
    worktree: operation.worktree,
    sourceRef: operation.sourceRef,
    sourceHead: operation.sourceHead,
    targetBefore: operation.targetBefore,
    forecastId: operation.forecastId ?? null,
    progress: {
      completed: operation.nextIndex,
      total: operation.queue.length,
      remaining: operation.queue.length - operation.nextIndex,
    },
    current: operation.current
      ? {
          ...operation.current,
          gitCherryPickHead: cherryPickHead(cwd),
          unresolvedPaths: unmergedPaths(cwd),
        }
      : null,
    applied: operation.applied,
    timings: operation.timings ?? null,
    startedAt: operation.startedAt,
    updatedAt: operation.updatedAt,
  };
}

function forkMergeMessage(operation, cwd) {
  const current = operation.current;
  if (!current.forkChangeId) current.forkChangeId = newId("ch");
  const filePath = mergeMessagePath(cwd);
  const original = fs.readFileSync(filePath, "utf8");
  const retained = original
    .split(/\r?\n/)
    .filter((line) => !/^Change-Id:\s*/i.test(line))
    .join("\n")
    .trimEnd();
  const trailers = [
    `Change-Id: ${current.forkChangeId}`,
    `Derived-From: ${current.sourceChangeId}`,
    `Origin-Commit: ${current.sourceCommit}`,
  ];
  fs.writeFileSync(filePath, `${retained}\n\n${trailers.join("\n")}\n`);
  writeReconciliationState(operation, cwd);
}

export function continueReconciliation(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const phaseStarted = performance.now();
  const operation = requirePendingReconciliation(cwd);
  if (!operation.current) {
    throw new CliError("The pending reconciliation has no current change.");
  }
  const unresolved = unmergedPaths(cwd);
  if (unresolved.length) {
    throw new CliError("Reconciliation still has unresolved paths.", {
      details: unresolved.join("\n"),
    });
  }
  const gitHead = cherryPickHead(cwd);
  if (!gitHead) {
    throw new CliError(
      "Git no longer has a cherry-pick to continue.",
      {
        details:
          "If Git was continued manually, abort this pending vlab operation and start a new reconciliation plan.",
      },
    );
  }
  if (gitHead !== operation.current.sourceCommit) {
    throw new CliError("Git's pending cherry-pick does not match the vlab operation.");
  }

  operation.current.resolutionOutcomes = captureResolutionOutcomes(
    operation.current.conflicts ?? [],
    cwd,
  );
  writeReconciliationState(operation, cwd);

  if (options.fork || operation.current.forkChangeId) {
    forkMergeMessage(operation, cwd);
  }
  const result = runGit(
    ["-c", "core.editor=true", "cherry-pick", "--continue"],
    { cwd, allowFailure: true },
  );
  if (!result.ok) {
    throw new CliError("Git could not continue the reconciliation.", {
      details: result.output,
    });
  }

  const relation = operation.current.forkChangeId
    ? "contextual-fork"
    : "contextual-application";
  recordSuccessfulApplication(operation, relation, cwd);
  return runReconciliationQueue(operation, cwd, phaseStarted);
}

export function abortReconciliation(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operation = requirePendingReconciliation(cwd);
  if (cherryPickHead(cwd)) {
    runGit(["cherry-pick", "--abort"], { cwd });
  } else {
    assertClean(cwd);
  }
  if (currentHead(cwd) !== operation.targetBefore) {
    runGit(["reset", "--hard", operation.targetBefore], { cwd });
  }
  clearReconciliationState(cwd);
  return {
    aborted: true,
    operationId: operation.id,
    restoredHead: currentHead(cwd),
  };
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
