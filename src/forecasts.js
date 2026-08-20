import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  beginGitMetrics,
  currentHead,
  endGitMetrics,
  repoContext,
  runGit,
  treeId,
} from "./git.js";
import { newId, sha256 } from "./ids.js";
import { buildMergePlan } from "./merge-plan.js";
import {
  captureConflictDescriptors,
  captureResolutionOutcomes,
  materializeResolutionCandidate,
} from "./resolutions.js";
import {
  readReconciliationState,
  unmergedPaths,
} from "./reconcile-state.js";
import { readJson, writeJson } from "./store.js";
import { listWorkspaces } from "./workspaces.js";
import { CliError } from "./errors.js";
import {
  compactSpecMerge,
  materializeSpecMerge,
  planSpecMerge,
  specFilesForConflictPaths,
} from "./specs.js";

function forecastDirectory(cwd) {
  return path.join(repoContext(cwd).gitDir, "vcs-lab", "forecasts");
}

function assertForecastId(id) {
  if (!/^forecast_[a-z0-9]+$/.test(String(id ?? ""))) {
    throw new CliError(`Invalid forecast ID '${id}'.`);
  }
  return id;
}

function forecastPath(id, cwd) {
  return path.join(forecastDirectory(cwd), `${assertForecastId(id)}.json`);
}

export function planFingerprint(plan) {
  return sha256(JSON.stringify({
    targetHead: plan.targetHead,
    sourceHead: plan.sourceHead,
    targetTree: plan.targetTree,
    sourceTree: plan.sourceTree,
    physicalBase: plan.physicalBase,
    effectiveBase: plan.effectiveBase,
    reachableReceipts: plan.reachableReceipts,
    changes: plan.changes.map((change) => ({
      commit: change.commit,
      changeId: change.changeId,
      status: change.status,
      proof: change.proof,
    })),
  }));
}

export function readForecast(id, cwd = process.cwd()) {
  const forecast = readJson(forecastPath(id, cwd), null);
  if (!forecast) {
    throw new CliError(`Forecast '${id}' was not found in this worktree.`);
  }
  return forecast;
}

function saveForecast(forecast, cwd) {
  writeJson(forecastPath(forecast.id, cwd), forecast);
  return forecast;
}

function withTemporaryWorktree(targetHead, cwd, callback) {
  const totalStarted = performance.now();
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "vcs-lab-forecast-"),
  );
  const temporaryWorktree = path.join(temporaryRoot, "worktree");
  let added = false;
  let pruneAfterRemoval = false;
  let value;
  let callbackError;
  let setupMs = 0;
  let callbackMs = 0;
  let cleanupMs = 0;
  try {
    const setupStarted = performance.now();
    runGit(
      ["worktree", "add", "--detach", temporaryWorktree, targetHead],
      { cwd },
    );
    added = true;
    setupMs = performance.now() - setupStarted;
    const callbackStarted = performance.now();
    value = callback(temporaryWorktree);
    callbackMs = performance.now() - callbackStarted;
  } catch (error) {
    callbackError = error;
  } finally {
    const cleanupStarted = performance.now();
    if (added) {
      if (fs.existsSync(temporaryWorktree)) {
        runGit(["cherry-pick", "--abort"], {
          cwd: temporaryWorktree,
          allowFailure: true,
        });
      }
      const removed = runGit(
        ["worktree", "remove", "--force", temporaryWorktree],
        { cwd, allowFailure: true },
      );
      pruneAfterRemoval = !removed.ok;
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (pruneAfterRemoval) runGit(["worktree", "prune"], { cwd });
    cleanupMs = performance.now() - cleanupStarted;
  }
  if (callbackError) throw callbackError;
  return {
    value,
    timings: {
      setupMs: Number(setupMs.toFixed(2)),
      applicationMs: Number(callbackMs.toFixed(2)),
      cleanupMs: Number(cleanupMs.toFixed(2)),
      totalMs: Number((performance.now() - totalStarted).toFixed(2)),
    },
  };
}

function simulationCounts(steps) {
  return steps.reduce(
    (counts, step) => {
      if (step.outcome === "clean") counts.clean += 1;
      if (step.resolutions?.length) {
        counts.exactResolution += 1;
        counts.exactResolutionPaths += step.resolutions.length;
      }
      if (step.semanticMerges?.length) {
        counts.semanticSpec += 1;
        counts.semanticSpecPaths += step.semanticMerges.length;
      }
      if (step.outcome.startsWith("blocked")) counts.blocked += 1;
      return counts;
    },
    {
      clean: 0,
      exactResolution: 0,
      exactResolutionPaths: 0,
      semanticSpec: 0,
      semanticSpecPaths: 0,
      blocked: 0,
    },
  );
}

function blockedReason(conflicts) {
  const missing = conflicts.filter((conflict) => conflict.candidates.length === 0);
  const ambiguous = conflicts.filter((conflict) => conflict.candidates.length > 1);
  if (missing.length && ambiguous.length) return "missing-and-ambiguous-resolutions";
  if (
    missing.some((conflict) =>
      conflict.semanticSpec?.conflicts?.some(
        (item) => item.type === "semantic-metadata-unavailable",
      ),
    )
  ) {
    return "semantic-spec-metadata-unavailable";
  }
  if (
    missing.some((conflict) =>
      conflict.semanticSpec?.conflicts?.length,
    )
  ) {
    return "semantic-spec-conflict";
  }
  if (missing.length) return "missing-exact-resolution";
  if (ambiguous.length) return "ambiguous-exact-resolution";
  return "unresolved-conflict";
}

function simulatePlan(plan, cwd) {
  const simulated = withTemporaryWorktree(plan.targetHead, cwd, (temporaryWorktree) => {
    const queue = plan.changes.filter((change) => change.status === "new");
    const steps = [];
    const approvedResolutions = [];
    const approvedSpecMerges = [];
    let status = "complete";
    let reason = null;

    for (const change of queue) {
      const targetBefore = currentHead(temporaryWorktree);
      const picked = runGit(["cherry-pick", "-x", change.commit], {
        cwd: temporaryWorktree,
        allowFailure: true,
      });
      if (picked.ok) {
        steps.push({
          sourceCommit: change.commit,
          changeId: change.changeId,
          subject: change.subject,
          outcome: "clean",
          relation: "causal-reconciliation",
          resultTree: treeId("HEAD", temporaryWorktree),
        });
        continue;
      }

      const paths = unmergedPaths(temporaryWorktree);
      if (paths.length === 0) {
        status = "blocked";
        reason = "git-application-error";
        steps.push({
          sourceCommit: change.commit,
          changeId: change.changeId,
          subject: change.subject,
          outcome: "blocked-git-error",
          gitOutput: picked.output,
        });
        break;
      }

      const conflicts = captureConflictDescriptors(paths, temporaryWorktree);
      const semanticPlans = specFilesForConflictPaths(paths)
        .map((file) =>
          planSpecMerge(
            file,
            `${change.commit}^`,
            targetBefore,
            change.commit,
            temporaryWorktree,
          ),
        );
      for (const semanticPlan of semanticPlans) {
        const descriptor = conflicts.find(
          (conflict) =>
            conflict.path === semanticPlan.file ||
            conflict.path === semanticPlan.manifestFile,
        );
        if (descriptor) descriptor.semanticSpec = compactSpecMerge(semanticPlan);
      }

      const semanticMerges = [];
      const semanticallyResolved = new Set();
      for (const semanticPlan of semanticPlans.filter(
        (candidate) => candidate.status === "clean",
      )) {
        materializeSpecMerge(semanticPlan, temporaryWorktree);
        const outcome = compactSpecMerge(semanticPlan, "forecast-batch");
        semanticMerges.push(outcome);
        for (const resolvedPath of outcome.resolvedPaths) {
          if (paths.includes(resolvedPath)) semanticallyResolved.add(resolvedPath);
        }
        approvedSpecMerges.push({
          sourceCommit: change.commit,
          path: outcome.path,
          signature: outcome.signature,
          resultMarkdownHash: outcome.resultMarkdownHash,
          resultManifestHash: outcome.resultManifestHash,
        });
      }
      const exactConflicts = conflicts.filter(
        (conflict) => !semanticallyResolved.has(conflict.path),
      );
      if (!exactConflicts.every((conflict) => conflict.candidates.length === 1)) {
        status = "blocked";
        reason = blockedReason(exactConflicts);
        steps.push({
          sourceCommit: change.commit,
          changeId: change.changeId,
          subject: change.subject,
          outcome: "blocked-conflict",
          conflicts,
          semanticMerges,
        });
        break;
      }

      for (const conflict of exactConflicts) {
        const candidate = conflict.candidates[0];
        materializeResolutionCandidate(conflict, candidate, temporaryWorktree);
        conflict.selectedResolutionId = candidate.id;
        conflict.selectionMethod = "forecast-batch";
      }
      const resolutions = captureResolutionOutcomes(
        exactConflicts,
        temporaryWorktree,
      );
      const continued = runGit(
        ["-c", "core.editor=true", "cherry-pick", "--continue"],
        { cwd: temporaryWorktree, allowFailure: true },
      );
      if (!continued.ok) {
        status = "blocked";
        reason = "exact-resolution-application-error";
        steps.push({
          sourceCommit: change.commit,
          changeId: change.changeId,
          subject: change.subject,
          outcome: "blocked-resolution-application",
          conflicts,
          semanticMerges,
          resolutions,
          gitOutput: continued.output,
        });
        break;
      }

      for (const resolution of resolutions) {
        approvedResolutions.push({
          sourceCommit: change.commit,
          path: resolution.path,
          signature: resolution.signature,
          resolutionId: resolution.selectedResolutionId,
          resultBlob: resolution.resultBlob,
        });
      }
      steps.push({
        sourceCommit: change.commit,
        changeId: change.changeId,
        subject: change.subject,
        outcome:
          semanticMerges.length && resolutions.length
            ? "semantic-spec-and-exact-resolution"
            : semanticMerges.length
              ? "semantic-spec-merge"
              : "exact-resolution",
        relation: "contextual-application",
        conflicts,
        resolutions,
        semanticMerges,
        resultTree: treeId("HEAD", temporaryWorktree),
      });
    }

    const partialResultTree = treeId("HEAD", temporaryWorktree);
    return {
      status,
      blockedReason: reason,
      steps,
      approvedResolutions,
      approvedSpecMerges,
      counts: simulationCounts(steps),
      simulatedChanges: steps.length,
      remainingChanges: queue.length - steps.length,
      partialResultTree,
      predictedResultTree: status === "complete" ? partialResultTree : null,
      exactStateEqualityAfter:
        status === "complete" ? partialResultTree === plan.sourceTree : null,
    };
  });
  return {
    ...simulated.value,
    worktreeTimings: simulated.timings,
  };
}

export function forecastReconciliation(sourceRef, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (readReconciliationState(cwd)) {
    throw new CliError(
      "Finish or abort the current reconciliation before forecasting another.",
    );
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const gitMetrics = beginGitMetrics("forecast");
  const phases = {};
  const preflightStarted = performance.now();
  const before = {
    head: currentHead(cwd),
    tree: treeId("HEAD", cwd),
    status: runGit(["status", "--porcelain=v1"], { cwd }).stdout,
  };
  phases.preflightMs = performance.now() - preflightStarted;
  const planningStarted = performance.now();
  const plan = buildMergePlan(sourceRef, cwd);
  phases.planningMs = performance.now() - planningStarted;
  const simulationStarted = performance.now();
  const simulation = simulatePlan(plan, cwd);
  phases.simulationMs = performance.now() - simulationStarted;
  const candidateDecisionRequired =
    plan.counts["candidate-equivalent"] > 0 && !options.acceptCandidates;
  if (candidateDecisionRequired && simulation.status === "complete") {
    simulation.status = "review-required";
    simulation.blockedReason = "heuristic-candidate-decision-required";
    simulation.predictedResultTree = null;
    simulation.exactStateEqualityAfter = null;
  }
  const invariantStarted = performance.now();
  const after = {
    head: currentHead(cwd),
    tree: treeId("HEAD", cwd),
    status: runGit(["status", "--porcelain=v1"], { cwd }).stdout,
  };
  if (
    before.head !== after.head ||
    before.tree !== after.tree ||
    before.status !== after.status
  ) {
    endGitMetrics(gitMetrics);
    throw new CliError("Forecasting unexpectedly changed the current worktree.");
  }
  phases.invariantCheckMs = performance.now() - invariantStarted;

  const context = repoContext(cwd);
  const git = endGitMetrics(gitMetrics);
  const { worktreeTimings, ...simulationResult } = simulation;
  const forecast = {
    schema: "vcs-lab.forecast/v2",
    id: newId("forecast"),
    sourceRef,
    sourceHead: plan.sourceHead,
    targetHead: plan.targetHead,
    targetWorktree: context.root,
    scope: "committed-heads",
    ignoredTargetDirtyFiles: before.status
      ? before.status.split(/\r?\n/).filter(Boolean).length
      : 0,
    acceptCandidates: Boolean(options.acceptCandidates),
    candidateDecisionRequired,
    planFingerprint: planFingerprint(plan),
    plan,
    ...simulationResult,
    workspaceComparison: options.workspaceComparison ?? null,
    timings: {
      forecastMs: Number((performance.now() - started).toFixed(2)),
      phases: Object.fromEntries(
        Object.entries(phases).map(([name, value]) => [name, Number(value.toFixed(2))]),
      ),
      worktree: worktreeTimings,
      git,
    },
    startedAt,
    createdAt: new Date().toISOString(),
  };
  return saveForecast(forecast, cwd);
}

export function forecastForPlan(id, plan, cwd = process.cwd()) {
  const forecast = readForecast(id, cwd);
  if (
    !["vcs-lab.forecast/v1", "vcs-lab.forecast/v2"].includes(forecast.schema) ||
    forecast.id !== id
  ) {
    throw new CliError(`Forecast '${id}' has invalid metadata.`);
  }
  const currentFingerprint = planFingerprint(plan);
  if (
    forecast.targetHead !== plan.targetHead ||
    forecast.sourceHead !== plan.sourceHead ||
    forecast.planFingerprint !== currentFingerprint
  ) {
    throw new CliError(`Forecast '${id}' no longer matches this reconciliation.`, {
      details:
        "A branch head or causal record changed. Generate and review a new forecast.",
    });
  }
  return forecast;
}

function requireWorkspace(workspaces, value, role) {
  const workspace = workspaces.find(
    (item) => item.name === value || item.id === value,
  );
  if (!workspace) throw new CliError(`${role} workspace '${value}' was not found.`);
  if (workspace.status !== "active") {
    throw new CliError(`${role} workspace '${value}' is not active.`);
  }
  return workspace;
}

export function forecastWorkspaces(targetName, sourceName, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const workspaces = listWorkspaces(cwd);
  const target = requireWorkspace(workspaces, targetName, "Target");
  const source = requireWorkspace(workspaces, sourceName, "Source");
  if (target.id === source.id) {
    throw new CliError("Choose two different workspaces to compare.");
  }
  return forecastReconciliation(source.compatibilityBranch, {
    cwd: target.path,
    acceptCandidates: options.acceptCandidates,
    workspaceComparison: {
      target: {
        id: target.id,
        name: target.name,
        path: target.path,
        head: target.head,
        ignoredDirtyFiles: target.dirtyFiles,
      },
      source: {
        id: source.id,
        name: source.name,
        path: source.path,
        head: source.head,
        ignoredDirtyFiles: source.dirtyFiles,
      },
      scope: "committed-heads",
    },
  });
}
