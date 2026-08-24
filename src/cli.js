import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  abortReconciliation,
  continueReconciliation,
  createCommit,
  cherryPick,
  reconcile,
  reconciliationStatus,
} from "./operations.js";
import { buildMergePlan, formatMergePlan } from "./merge-plan.js";
import { buildRebasePlan, formatRebasePlan } from "./rebase-plan.js";
import {
  forecastRebase,
  formatRebaseForecast,
} from "./rebase-forecast.js";
import {
  abortRebase,
  continueRebase,
  rebaseStatus,
  startRebase,
} from "./rebase-operations.js";
import { land } from "./landings.js";
import { initLab } from "./store.js";
import {
  beginGitMetrics,
  commitSubject,
  currentHead,
  endGitMetrics,
  gitObjectSessionEnabled,
  runGit,
  treeId,
  withGitObjectSession,
} from "./git.js";
import {
  archiveWorkspace,
  checkpointWorkspace,
  createWorkspace,
  listWorkspaces,
  moveWorkspace,
  pruneWorkspaces,
  repairWorkspace,
  restoreWorkspace,
} from "./workspaces.js";
import {
  applyPendingSpecMerges,
  benchmarkSpecIndex,
  indexAllSpecs,
  indexSpec,
  pendingSpecMergeStatus,
  planSpecMerge,
  readSpecManifest,
} from "./specs.js";
import { listNoteRecords } from "./notes.js";
import { CliError } from "./errors.js";
import { VERSION } from "./version.js";
import {
  applyResolution,
  listResolutionRecords,
  pendingResolutionStatus,
  rejectResolution,
} from "./resolutions.js";
import {
  forecastReconciliation,
  forecastWorkspaces,
} from "./forecasts.js";
import { metadataStatus, validateMetadata } from "./metadata.js";
import { exportMetadata, importMetadata } from "./metadata-transfer.js";

const HELP = `vcs-lab — Git-backed experiments for causal source control

Usage:
  vlab init
  vlab commit -m <message> [--all] [--allow-empty]
  vlab branch <name> [from]
  vlab merge <source> [--compact | --hard-squash] [-m <message>]
  vlab compact-merge <source> [-m <message>]
  vlab hard-squash <source> [-m <message>]
  vlab merge-plan <source> [--json]
  vlab rebase-plan <onto> [<source>] [--json]
  vlab rebase-forecast <onto> [<source>] [--accept-candidates] [--json]
  vlab rebase <onto> [--accept-candidates] [--use-forecast <id>] [--json]
  vlab rebase --status [--json]
  vlab rebase --continue [--fork] [--json]
  vlab rebase --abort [--json]
  vlab forecast <source> [--accept-candidates] [--json]
  vlab reconcile <source> [--accept-candidates] [--use-forecast <id>] [--json]
  vlab reconcile --status [--json]
  vlab reconcile --continue [--fork] [--json]
  vlab reconcile --abort [--json]
  vlab resolve status [--json]
  vlab resolve apply [path] [--all] [--resolution <id>] [--json]
  vlab resolve reject [path] [--all] [--resolution <id>] [--json]
  vlab resolve list [--json]
  vlab cherry-pick <commit-or-change-id> [--fork] [--repeat] [--json]
  vlab graph
  vlab receipts [--json]
  vlab metadata status [--json]
  vlab metadata validate [--strict] [--json]
  vlab metadata export <directory> [--json]
  vlab metadata import <directory> --dry-run [--json]
  vlab metadata import <directory> --apply [--json]
  vlab workspace create <name> [--from <ref>] [--path <directory>] [--owner <name>] [--focus <text>]
  vlab workspace list [--json]
  vlab workspace checkpoint [--label <text>] [--json]
  vlab workspace move <name> <directory> [--json]
  vlab workspace archive <name> [--json]
  vlab workspace restore <name> [--path <directory>] [--json]
  vlab workspace repair <name> --path <directory> [--json]
  vlab workspace prune [--dry-run|--apply] [--json]
  vlab workspace forecast <target> <source> [--source-checkpoint] [--accept-candidates] [--json]
  vlab spec index <markdown-file> [--force] [--json]
  vlab spec index --all [--force] [--json]
  vlab spec show <markdown-file> [--json]
  vlab spec merge-plan <markdown-file> <base> <ours> <theirs> [--json]
  vlab spec status [--json]
  vlab spec resolve [markdown-file] [--all] [--json]
  vlab spec benchmark [--documents <n>] [--blocks <n>] [--json]
  vlab doctor [--benchmark] [--samples <n>] [--warmup <n>]
  vlab version

Plan legend: '=' proven covered/omit, '?' heuristic review, '+' new/replay.

Global diagnostics:
  --trace-git        print per-command process/session timings to stderr
  --git-session      force persistent Git object plumbing for this command
  --no-git-session  use ordinary one-process-per-command Git plumbing
`;

function parseArgs(args) {
  const positionals = [];
  const options = {};
  const valueFlags = new Set(["--message", "-m", "--from", "--path", "--owner", "--focus", "--label", "--resolution", "--use-forecast", "--samples", "--warmup", "--documents", "--blocks"]);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (valueFlags.has(item)) {
      const value = args[index + 1];
      if (value === undefined) throw new CliError(`${item} requires a value.`);
      const key = item === "-m" ? "message" : item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = value;
      index += 1;
    } else if (item.startsWith("--")) {
      options[item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else {
      positionals.push(item);
    }
  }
  return { positionals, options };
}

function requireValue(value, usage) {
  if (!value) throw new CliError(`Missing required argument. Usage: ${usage}`);
  return value;
}

function print(value, json = false) {
  if (json || typeof value !== "string") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

function formatMetadataStatus(result, title = "Metadata status") {
  const lines = [
    title,
    `repository   ${result.repository.root}`,
    `object format ${result.repository.objectFormat}`,
    `lineage      ${short(result.repository.lineage.id)}`,
    `notes        ${result.scopes.sharedPortable.notes.targetCount} targets; ${result.scopes.sharedPortable.notes.acceptedCount} accepted, ${result.scopes.sharedPortable.notes.quarantinedCount} quarantined`,
    `resolutions  ${result.scopes.sharedPortable.resolutions.acceptedRefCount}/${result.scopes.sharedPortable.resolutions.refCount} refs accepted`,
    `specs        ${result.scopes.trackedPortable.consistentCount}/${result.scopes.trackedPortable.manifestCount} manifests consistent`,
    `local        ${result.scopes.sharedLocal.checkpoints.totalRefCount ?? result.scopes.sharedLocal.checkpoints.refCount} checkpoint refs; ${result.scopes.sharedLocal.workspaceRegistry.count} workspaces`,
    `private      ${result.scopes.worktreePrivate.pendingOperationCount} operations; ${result.scopes.worktreePrivate.forecastCount} forecasts`,
    `diagnostics  ${result.summary.errors} errors, ${result.summary.warnings} warnings`,
    `integrity    ${result.summary.valid ? "valid" : "invalid"}; not signed or authorized`,
  ];
  for (const diagnostic of result.diagnostics) {
    lines.push(`  ${diagnostic.severity === "error" ? "!" : "?"} ${diagnostic.code}: ${diagnostic.subject}`);
  }
  return lines.join("\n");
}

function formatMetadataTransfer(result) {
  if (result.schema === "vcs-lab.metadata-export/v1") {
    return [
      "Metadata exported",
      `path         ${result.path}`,
      `records      ${result.records}`,
      `refs         ${result.refs}`,
      `quarantined  ${result.quarantinedRecords} excluded`,
      `payload      ${result.bytes} bytes`,
      "trust        integrity only; not signed or authorized",
    ].join("\n");
  }
  return [
    result.applied ? "Metadata import applied" : "Metadata import preview",
    `path         ${result.path}`,
    `lineage      ${result.repository.lineageRelation}`,
    `records      ${result.summary.addRecords} add, ${result.summary.noopRecords} unchanged`,
    `refs         ${result.summary.createRefs} create, ${result.summary.mergeRefs} merge, ${result.summary.noopRefs} unchanged`,
    `conflicts    ${result.summary.conflicts}`,
    `applicable   ${result.summary.applicable ? "yes" : "no"}`,
    "trust        integrity only; not signed or authorized",
  ].join("\n");
}

function formatSpecResult(result) {
  const { manifest, changes, manifestPath } = result;
  return [
    `artifact     ${manifest.artifactId}`,
    `source       ${manifest.source}`,
    `manifest     ${path.relative(process.cwd(), manifestPath)}`,
    `blocks       ${manifest.blocks.length}`,
    `index        ${result.cacheHit ? `cache hit (${result.cacheMode}); manifest unchanged` : "manifest written"}`,
    ...(result.migratedFrom ? [`migration    ${result.migratedFrom} -> ${manifest.schema}`] : []),
    `changes      ${changes.added.length} added, ${changes.changed.length} changed, ${changes.moved.length} moved, ${changes.removed.length} removed`,
  ].join("\n");
}

function formatSpecBatch(result) {
  return [
    "Specification index",
    `files        ${result.files}`,
    `entities     ${result.blocks}`,
    `cache hits   ${result.cacheHits}`,
    `blob hits    ${result.blobCacheHits}; ${result.contentReads} content reads`,
    `written      ${result.manifestsWritten}`,
    `changes      ${result.changes.added} added, ${result.changes.changed} changed, ${result.changes.moved} moved, ${result.changes.removed} removed`,
    `duration     ${result.totalDurationMs.toFixed(2)} ms (${result.preparationMs.toFixed(2)} ms Git preparation)`,
  ].join("\n");
}

function formatSpecMergePlan(plan) {
  const lines = [
    "Semantic specification merge",
    `status       ${plan.status}`,
    `source       ${plan.file}`,
    `artifact     ${plan.artifactId ?? "incompatible"}`,
    `signature    ${short(plan.signature)}`,
    `ordering     ${plan.ordering.decision}`,
  ];
  const decisions = Object.entries(plan.counts)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
  if (decisions) lines.push(`blocks       ${decisions}`);
  for (const conflict of plan.conflicts) {
    lines.push(
      `! ${conflict.type}${conflict.title ? `: ${conflict.title}` : ""}`,
    );
  }
  if (plan.status === "clean") {
    lines.push(
      `result       ${short(plan.result?.markdownHash)}`,
      "The plan is deterministic; no language model judgment was used.",
    );
  } else {
    lines.push("Ambiguous blocks remain for explicit review.");
  }
  return lines.join("\n");
}

function formatSpecMergeStatus(status) {
  if (!status.active) return "No semantic specification merge is pending.";
  const lines = [`operation    ${status.operationId}`];
  for (const plan of status.plans) {
    lines.push(
      "",
      `path         ${plan.path}`,
      `status       ${plan.status}`,
      `signature    ${short(plan.signature)}`,
      `ordering     ${plan.ordering}`,
    );
    for (const conflict of plan.conflicts) {
      lines.push(`  ! ${conflict.type}${conflict.title ? `: ${conflict.title}` : ""}`);
    }
  }
  if (status.plans.some((plan) => plan.status === "clean")) {
    lines.push("", "Apply deterministic suggestions with: vlab spec resolve --all");
  }
  return lines.join("\n");
}

function formatSpecMergeAction(result) {
  return [
    `Applied ${result.applied.length} deterministic spec merge${result.applied.length === 1 ? "" : "s"}.`,
    ...result.applied.map((item) => `  ${item.path}`),
    "Inspect the staged Markdown and sidecars, then run: vlab reconcile --continue",
  ].join("\n");
}

function short(value) {
  return value ? String(value).slice(0, 12) : "-";
}

function recordTitle(record) {
  return `${String(record.type ?? "record").toUpperCase()} ${record.id ?? "(no id)"}`;
}

function formatReceipt(record) {
  const lines = [recordTitle(record)];
  if (record.type === "landing") {
    lines.push(
      `  landing     ${short(record.landingCommit ?? record.attachedTo)}`,
      `  source      ${record.sourceRef ?? "-"} @ ${short(record.sourceHead)}`,
      `  mode        ${record.mode ?? "-"}`,
      `  absorbed    ${(record.absorbedChanges ?? []).length} changes in ${(record.absorbedCommits ?? []).length} commits`,
    );
  } else if (record.type === "application") {
    lines.push(
      `  applied     ${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}`,
      `  change      ${record.appliedChangeId ?? record.originChangeId ?? "-"}`,
      `  relation    ${record.relation ?? "-"}`,
    );
    if ((record.conflictedPaths ?? []).length) {
      lines.push(`  conflicts   ${record.conflictedPaths.join(", ")}`);
    }
    if ((record.resolutions ?? []).length) {
      const decisions = record.resolutions.map((item) => item.decision);
      lines.push(`  resolutions ${decisions.join(", ")}`);
    }
    if ((record.semanticMerges ?? []).length) {
      lines.push(
        `  spec merges ${record.semanticMerges.map((item) => `${item.decision ?? "recorded"}:${item.path}`).join(", ")}`,
      );
    }
  } else if (record.type === "rebase-application") {
    lines.push(
      `  replayed    ${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}`,
      `  change      ${record.appliedChangeId ?? record.originChangeId ?? "-"}`,
      `  relation    ${record.relation ?? "-"}`,
      `  trees       ${short(record.targetBeforeTree)} -> ${short(record.resultTree)}`,
    );
    if ((record.conflictedPaths ?? []).length) {
      lines.push(`  conflicts   ${record.conflictedPaths.join(", ")}`);
    }
  } else if (record.type === "resolution") {
    lines.push(
      `  signature   ${short(record.signature)}`,
      `  result      ${short(record.resultBlob)}`,
      `  path        ${record.originalPath ?? "-"}`,
      `  decision    ${record.decision ?? "-"}`,
    );
  } else if (record.type === "reconciliation") {
    lines.push(
      `  result      ${short(record.resultCommit ?? record.attachedTo)}`,
      `  source      ${record.sourceRef ?? "-"} @ ${short(record.sourceHead)}`,
      `  covered     ${(record.absorbedChanges ?? []).length} changes; ${(record.applied ?? []).length} applied now`,
    );
    if (record.forecastId) lines.push(`  forecast    ${record.forecastId}`);
    if (record.timings?.activeApplicationMs !== undefined) {
      lines.push(
        `  active time ${record.timings.activeApplicationMs.toFixed(2)} ms`,
      );
    }
    if (record.timings?.git?.count !== undefined) {
      const activity = formatGitActivity(record.timings.git);
      lines.push(`  ${activity}`);
    }
    if (record.exactStateEqualityAfter !== undefined) {
      lines.push(
        `  same before ${record.exactStateEqualityBefore ? "yes" : "no"}`,
        `  same after  ${record.exactStateEqualityAfter ? "yes" : "no"}`,
      );
    } else if (record.exactStateEquality !== undefined) {
      lines.push(
        `  same before ${record.exactStateEquality ? "yes" : "no"}`,
        "  same after  not recorded by v1 receipt",
      );
    } else {
      lines.push("  same state  not recorded");
    }
  } else if (record.type === "rebase") {
    lines.push(
      `  result      ${short(record.resultCommit ?? record.attachedTo)}`,
      `  source      ${record.sourceRef ?? "-"} @ ${short(record.sourceHead)}`,
      `  onto        ${record.ontoRef ?? "-"} @ ${short(record.ontoHead)}`,
      `  coverage    ${(record.absorbedChanges ?? []).length} changes; ${(record.applications ?? []).length} replayed`,
      `  same state  ${record.exactStateEqualityAfter ? "yes" : "no"}`,
    );
    if (record.forecastId) lines.push(`  forecast    ${record.forecastId}`);
    if (record.timings?.activeApplicationMs !== undefined) {
      lines.push(`  active time ${record.timings.activeApplicationMs.toFixed(2)} ms`);
    }
  } else {
    lines.push(`  attached    ${short(record.attachedTo)}`);
  }
  if (record.createdAt) lines.push(`  created     ${record.createdAt}`);
  return lines.join("\n");
}

function formatReceipts(records) {
  if (records.length === 0) return "No causal records found.";
  return `${records.length} causal record${records.length === 1 ? "" : "s"}\n\n${records
    .map(formatReceipt)
    .join("\n\n")}`;
}

function formatGitActivity(git, label = "git work") {
  if (!git) return null;
  const processes = git.processes ?? git.count;
  return `${label.padEnd(12)} ${processes} processes; ${git.count} queries (${git.totalMs.toFixed(2)} ms)`;
}

function formatCausalEdges(records) {
  const lines = [];
  const consumedReconciliations = new Set();
  const reconciliationsByApplication = new Map();
  for (const record of records) {
    if (record.type !== "reconciliation" || record.applied?.length !== 1) continue;
    const application = record.applied[0];
    if (
      application.sourceCommit === record.sourceHead &&
      application.appliedCommit === record.resultCommit
    ) {
      reconciliationsByApplication.set(
        `${record.resultCommit}:${record.sourceHead}`,
        record,
      );
    }
  }
  for (const record of records) {
    if (record.type === "landing") {
      lines.push(
        `${short(record.landingCommit ?? record.attachedTo)} <= ${short(record.sourceHead)}  ${record.mode}; ${(record.absorbedChanges ?? []).length} changes absorbed`,
      );
    } else if (record.type === "application") {
      const relation = record.relation ?? "application";
      const reconciliation = reconciliationsByApplication.get(
        `${record.appliedCommit ?? record.attachedTo}:${record.originCommit}`,
      );
      const suffix = reconciliation
        ? `; reconciliation ${reconciliation.absorbedChanges?.length ?? 0} covered`
        : "";
      if (reconciliation) consumedReconciliations.add(reconciliation.id);
      lines.push(
        `${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}  ${relation} ${record.appliedChangeId ?? record.originChangeId ?? "unknown"}${suffix}`,
      );
    } else if (record.type === "rebase-application") {
      lines.push(
        `${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}  ${record.relation ?? "causal-rebase"} ${record.appliedChangeId ?? record.originChangeId ?? "unknown"}`,
      );
    } else if (record.type === "reconciliation") {
      if (consumedReconciliations.has(record.id)) continue;
      lines.push(
        `${short(record.resultCommit ?? record.attachedTo)} <= ${short(record.sourceHead)}  reconcile; ${(record.absorbedChanges ?? []).length} covered, ${(record.applied ?? []).length} applied`,
      );
    } else if (record.type === "rebase") {
      lines.push(
        `${short(record.resultCommit ?? record.attachedTo)} <= ${short(record.sourceHead)}  rebase onto ${short(record.ontoHead)}; ${(record.absorbedChanges ?? []).length} covered, ${(record.applications ?? []).length} replayed`,
      );
    }
  }
  if (lines.length === 0) return "  (none)";
  return lines.map((line) => `  ${line}`).join("\n");
}

function formatReconciliationResult(result) {
  const { receipt } = result;
  const contextual = receipt.applied.filter((item) =>
    item.relation?.startsWith("contextual-"),
  );
  const decisions = receipt.applied
    .flatMap((item) => item.resolutions ?? [])
    .reduce((counts, item) => {
      counts[item.decision] = (counts[item.decision] ?? 0) + 1;
      return counts;
    }, {});
  const decisionText = Object.entries(decisions)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
  const semanticMerges = receipt.applied.reduce(
    (count, item) => count + (item.semanticMerges?.length ?? 0),
    0,
  );
  return [
    "Reconciliation complete.",
    `operation    ${result.operationId}`,
    `result       ${short(receipt.resultCommit)}`,
    `source       ${receipt.sourceRef} @ ${short(receipt.sourceHead)}`,
    `coverage     ${receipt.absorbedChanges.length} covered; ${receipt.applied.length} applied`,
    `contextual   ${contextual.length}`,
    `same state   ${receipt.exactStateEqualityAfter ? "yes" : "no"}`,
    receipt.forecastId ? `forecast     ${receipt.forecastId}` : null,
    receipt.timings
      ? `active time  ${receipt.timings.activeApplicationMs.toFixed(2)} ms`
      : null,
    receipt.timings?.git
      ? formatGitActivity(receipt.timings.git)
      : null,
    semanticMerges ? `spec merges  ${semanticMerges} deterministic` : null,
    decisionText ? `resolutions  ${decisionText}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRebaseResult(result) {
  const receipt = result.receipt;
  const forked = receipt.applications.filter(
    (application) => application.relation === "contextual-fork",
  ).length;
  const contextual = receipt.applications.filter(
    (application) => application.relation === "contextual-rebase",
  ).length;
  return [
    "Causal rebase complete.",
    `operation    ${result.operationId}`,
    `branch       ${receipt.sourceRef}`,
    `source       ${short(receipt.sourceHead)}`,
    `onto         ${receipt.ontoRef} @ ${short(receipt.ontoHead)}`,
    `result       ${short(receipt.resultCommit)}`,
    `coverage     ${receipt.omitted.length} exact omit; ${receipt.acceptedCandidates.length} accepted candidate; ${receipt.applications.length} replayed`,
    `contextual   ${contextual}`,
    `forked       ${forked}`,
    `same state   ${receipt.exactStateEqualityAfter ? "yes" : "no"}`,
    receipt.forecastId ? `forecast     ${receipt.forecastId}` : null,
    receipt.timings
      ? `active time  ${receipt.timings.activeApplicationMs.toFixed(2)} ms`
      : null,
    receipt.timings?.git
      ? formatGitActivity(receipt.timings.git)
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatForecast(forecast) {
  const counts = forecast.counts;
  const scope = forecast.scope === "source-checkpoint"
    ? "immutable source checkpoint"
    : "committed heads only";
  const lines = [
    "Reconciliation forecast",
    `forecast     ${forecast.id}`,
    `status       ${forecast.status}`,
    `target       ${short(forecast.targetHead)}`,
    `source       ${forecast.sourceRef} @ ${short(forecast.sourceHead)}`,
    `scope        ${scope}`,
    `plan         ${forecast.plan.counts.covered} covered, ${forecast.plan.counts["candidate-equivalent"]} candidate, ${forecast.plan.counts.new} new`,
    `simulation   ${counts.clean} clean, ${counts.exactResolution} exact-resolved, ${counts.semanticSpec ?? 0} spec-merged, ${counts.blocked} blocked`,
    `predicted    ${short(forecast.predictedResultTree)}`,
    `partial      ${short(forecast.partialResultTree)}`,
    `same state   ${forecast.exactStateEqualityAfter === null ? "unknown" : forecast.exactStateEqualityAfter ? "yes" : "no"}`,
    `forecast time ${forecast.timings.forecastMs.toFixed(2)} ms`,
    forecast.timings.git
      ? formatGitActivity(forecast.timings.git)
      : null,
  ].filter(Boolean);
  if (forecast.ignoredTargetDirtyFiles) {
    lines.push(`target dirty ${forecast.ignoredTargetDirtyFiles} files ignored`);
  }
  if (forecast.workspaceComparison) {
    const comparison = forecast.workspaceComparison;
    lines.push(
      `workspaces   ${comparison.target.name} <= ${comparison.source.name}`,
    );
    const dirty = [comparison.target, comparison.source].filter(
      (workspace) => workspace.ignoredDirtyFiles,
    );
    if (dirty.length) {
      lines.push(
        `dirty ignored ${dirty.map((workspace) => `${workspace.name}:${workspace.ignoredDirtyFiles}`).join(", ")}`,
      );
    }
    const checkpoint = comparison.source.checkpoint;
    if (checkpoint) {
      lines.push(
        `checkpoint   ${short(checkpoint.id)} tree ${short(checkpoint.tree)}`,
        `draft change ${checkpoint.draftChangeId}`,
      );
    }
  }
  lines.push("");
  if (forecast.steps.length === 0) {
    lines.push("No new source changes require simulation.");
  }
  for (const step of forecast.steps) {
    if (step.outcome === "clean") {
      lines.push(`C ${short(step.sourceCommit)} ${step.subject} [clean]`);
    } else if (!step.outcome.startsWith("blocked")) {
      const labels = [];
      if (step.semanticMerges?.length) {
        labels.push(`${step.semanticMerges.length} deterministic spec merge${step.semanticMerges.length === 1 ? "" : "s"}`);
      }
      if (step.resolutions?.length) {
        labels.push(`${step.resolutions.length} exact resolution${step.resolutions.length === 1 ? "" : "s"}`);
      }
      lines.push(
        `R ${short(step.sourceCommit)} ${step.subject} [${labels.join(", ")}]`,
      );
      for (const merge of step.semanticMerges ?? []) {
        lines.push(`  ${merge.path} <= stable block IDs`);
      }
      for (const resolution of step.resolutions ?? []) {
        lines.push(
          `  ${resolution.path} <= ${resolution.selectedResolutionId}`,
        );
      }
    } else {
      lines.push(`! ${short(step.sourceCommit)} ${step.subject} [blocked]`);
      for (const conflict of step.conflicts ?? []) {
        lines.push(
          `  ${conflict.path}: ${conflict.candidates.length} exact candidate${conflict.candidates.length === 1 ? "" : "s"}`,
        );
        for (const semantic of conflict.semanticSpec?.conflicts ?? []) {
          lines.push(`    semantic blocker: ${semantic.type}`);
        }
      }
    }
  }
  if (forecast.blockedReason) lines.push("", `blocked by   ${forecast.blockedReason}`);
  lines.push(
    "",
    "The current HEAD, index, and working files were not changed.",
  );
  if (forecast.candidateDecisionRequired) {
    const reviewCommand = forecast.workspaceComparison
      ? [
          "vlab workspace forecast",
          forecast.workspaceComparison.target.name,
          forecast.workspaceComparison.source.name,
          forecast.scope === "source-checkpoint" ? "--source-checkpoint" : null,
          "--accept-candidates",
        ].filter(Boolean).join(" ")
      : `vlab forecast ${forecast.sourceRef} --accept-candidates`;
    lines.push(
      "Review the heuristic candidates, then regenerate with:",
      `  ${reviewCommand}`,
    );
    return lines.join("\n");
  }
  if (forecast.workspaceComparison) {
    lines.push(
      `Run from target worktree: ${forecast.workspaceComparison.target.path}`,
    );
  }
  lines.push(
    "Start the pinned reconciliation with:",
    `  vlab reconcile ${forecast.sourceRef} --use-forecast ${forecast.id}`,
  );
  return lines.join("\n");
}

function formatResolutionStatus(status) {
  if (!status.active) return "No reusable conflict resolution is pending.";
  const lines = [`operation    ${status.operationId}`];
  for (const conflict of status.conflicts) {
    lines.push(
      "",
      `path         ${conflict.path}`,
      `signature    ${short(conflict.signature)}`,
      `candidates   ${conflict.candidates.length}`,
    );
    for (const candidate of conflict.candidates) {
      lines.push(
        `  ${candidate.id} result ${short(candidate.resultBlob)} from ${candidate.originalPath ?? "unknown path"}`,
      );
    }
  }
  if (status.conflicts.some((conflict) => conflict.candidates.length)) {
    lines.push("", "Apply a suggestion with: vlab resolve apply --all");
  }
  return lines.join("\n");
}

function formatResolutionAction(result, action) {
  const items = result[action] ?? [];
  return [
    `${action === "applied" ? "Applied" : "Rejected"} ${items.length} resolution suggestion${items.length === 1 ? "" : "s"}.`,
    ...items.map((item) => `  ${item.path}`),
    action === "applied"
      ? "Continue with: vlab reconcile --continue"
      : "Resolve the files manually, stage them, then continue reconciliation.",
  ].join("\n");
}

function formatResolutionCatalog(records) {
  if (!records.length) return "No reusable resolutions have been recorded.";
  return [
    `${records.length} reusable resolution${records.length === 1 ? "" : "s"}`,
    "",
    ...records.flatMap((record) => [
      `${record.id}  ${short(record.signature)} -> ${short(record.resultBlob)}`,
      `  original path ${record.originalPath ?? "-"}; ${record.createdAt ?? "unknown time"}`,
    ]),
  ].join("\n");
}

function positiveInteger(value, fallback, name, minimum = 1) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 100) {
    throw new CliError(`${name} must be an integer between ${minimum} and 100.`);
  }
  return parsed;
}

function percentile(sorted, fraction) {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function gitBenchmark(options = {}) {
  const sampleCount = positiveInteger(options.samples, 3, "--samples");
  const warmupCount = positiveInteger(options.warmup, 1, "--warmup", 0);
  const probes = [
    { name: "head", args: ["rev-parse", "HEAD"] },
    { name: "status", args: ["status", "--porcelain=v1"] },
    { name: "history", args: ["log", "-20", "--format=%H"] },
    { name: "notes", args: ["notes", "--ref=vcs-lab", "list"], allowFailure: true },
  ];
  return probes.map((probe) => {
    for (let index = 0; index < warmupCount; index += 1) {
      runGit(probe.args, { allowFailure: probe.allowFailure });
    }
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(
        runGit(probe.args, { allowFailure: probe.allowFailure }).durationMs,
      );
    }
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      name: probe.name,
      warmup: warmupCount,
      samplesMs: samples.map((sample) => Number(sample.toFixed(2))),
      averageMs: Number(
        (samples.reduce((sum, sample) => sum + sample, 0) / samples.length).toFixed(2),
      ),
      medianMs: Number(percentile(sorted, 0.5).toFixed(2)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
      minMs: Number(Math.min(...samples).toFixed(2)),
      maxMs: Number(Math.max(...samples).toFixed(2)),
    };
  });
}

function gitObjectSessionBenchmark(options = {}, cwd = process.cwd()) {
  const sampleCount = positiveInteger(options.samples, 3, "--samples");
  const collector = beginGitMetrics("doctor-object-session");
  const started = performance.now();
  withGitObjectSession(cwd, () => {
    for (let index = 0; index < sampleCount; index += 1) {
      const head = currentHead(cwd);
      treeId(head, cwd);
      commitSubject(head, cwd);
    }
  });
  return {
    enabled: gitObjectSessionEnabled(),
    rounds: sampleCount,
    logicalReads: sampleCount * 3,
    durationMs: Number((performance.now() - started).toFixed(2)),
    git: endGitMetrics(collector),
  };
}

function formatReconciliationStatus(status) {
  if (!status.active) return "No reconciliation is in progress in this worktree.";
  const lines = [
    `operation    ${status.operationId}`,
    `state        ${status.state}`,
    `source       ${status.sourceRef} @ ${short(status.sourceHead)}`,
    `target start ${short(status.targetBefore)}`,
    `progress     ${status.progress.completed}/${status.progress.total} applied`,
  ];
  if (status.current) {
    lines.push(
      `current      ${short(status.current.sourceCommit)} ${status.current.sourceChangeId}`,
    );
    const paths = status.current.unresolvedPaths?.length
      ? status.current.unresolvedPaths
      : status.current.conflictedPaths;
    if (paths?.length) lines.push(`conflicts    ${paths.join(", ")}`);
  }
  lines.push(
    "",
    status.state === "conflicted"
      ? "Resolve and stage the conflicts, then run: vlab reconcile --continue"
      : status.state === "forecast-mismatch"
        ? "The applied tree diverged from its forecast and cannot be published."
        : "The operation is resumable in this worktree.",
    "Abort and restore the starting commit with: vlab reconcile --abort",
  );
  return lines.join("\n");
}

function formatRebaseStatus(status) {
  if (!status.active) return "No causal rebase is in progress in this worktree.";
  const lines = [
    `operation    ${status.operationId}`,
    `state        ${status.state}`,
    `branch       ${status.sourceRef}`,
    `source start ${short(status.sourceHead)}`,
    `onto         ${status.ontoRef} @ ${short(status.ontoHead)}`,
    `progress     ${status.progress.completed}/${status.progress.total} replayed`,
  ];
  if (status.current) {
    lines.push(
      `current      ${short(status.current.sourceCommit)} ${status.current.sourceChangeId}`,
    );
    const paths = status.current.unresolvedPaths?.length
      ? status.current.unresolvedPaths
      : status.current.conflictedPaths;
    if (paths?.length) lines.push(`conflicts    ${paths.join(", ")}`);
  }
  if (!status.recovery.branchMatches) {
    lines.push(
      "",
      `branch mismatch: switch back to ${status.sourceRef} before recovery.`,
    );
  }
  lines.push(
    "",
    status.state === "conflicted"
      ? "Resolve and stage the conflicts, then run: vlab rebase --continue"
      : ["forecast-mismatch", "identity-mismatch", "blocked"].includes(status.state)
        ? "The operation is blocked and cannot publish receipts."
        : "The operation is resumable in this worktree.",
    "Abort and restore the original branch tip with: vlab rebase --abort",
  );
  return lines.join("\n");
}

export async function main(rawArgs) {
  const forceSession = rawArgs.includes("--git-session");
  const disableSession = rawArgs.includes("--no-git-session");
  if (forceSession && disableSession) {
    throw new CliError("Choose only one of --git-session or --no-git-session.");
  }
  if (rawArgs.includes("--trace-git")) process.env.VLAB_TRACE = "1";
  if (forceSession) process.env.VLAB_GIT_SESSION = "1";
  if (disableSession) process.env.VLAB_GIT_SESSION = "0";
  const args = rawArgs.filter(
    (item) => !["--trace-git", "--git-session", "--no-git-session"].includes(item),
  );
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "version" || command === "--version" || command === "-V") {
    console.log(`vcs-lab ${VERSION}`);
    return;
  }

  const { positionals, options } = parseArgs(rest);
  switch (command) {
    case "init": {
      const context = initLab();
      print(`Initialized vcs-lab metadata in ${context.root}`);
      return;
    }
    case "commit": {
      const message = requireValue(options.message, "vlab commit -m <message>");
      const result = createCommit(message, {
        all: options.all,
        allowEmpty: options.allowEmpty,
      });
      print(result, options.json);
      return;
    }
    case "branch": {
      const name = requireValue(positionals[0], "vlab branch <name> [from]");
      const from = positionals[1] ?? "HEAD";
      runGit(["switch", "-c", name, from]);
      print(`Created and switched to ${name} from ${from}`);
      return;
    }
    case "merge":
    case "compact-merge":
    case "hard-squash": {
      const source = requireValue(positionals[0], `vlab ${command} <source>`);
      let mode = command === "hard-squash" || options.hardSquash ? "hard-squash" : "compact";
      if (options.compact) mode = "compact";
      const receipt = land(source, mode, { message: options.message });
      print(receipt, options.json);
      return;
    }
    case "merge-plan": {
      const source = requireValue(positionals[0], "vlab merge-plan <source>");
      const plan = buildMergePlan(source);
      print(options.json ? plan : formatMergePlan(plan), options.json);
      return;
    }
    case "rebase-plan": {
      const onto = requireValue(
        positionals[0],
        "vlab rebase-plan <onto> [<source>]",
      );
      if (positionals.length > 2) {
        throw new CliError("Usage: vlab rebase-plan <onto> [<source>]");
      }
      const plan = buildRebasePlan(onto, positionals[1]);
      print(options.json ? plan : formatRebasePlan(plan), options.json);
      return;
    }
    case "rebase-forecast": {
      const onto = requireValue(
        positionals[0],
        "vlab rebase-forecast <onto> [<source>]",
      );
      if (positionals.length > 2) {
        throw new CliError(
          "Usage: vlab rebase-forecast <onto> [<source>]",
        );
      }
      const forecast = forecastRebase(onto, positionals[1], {
        acceptCandidates: options.acceptCandidates,
      });
      print(
        options.json ? forecast : formatRebaseForecast(forecast),
        options.json,
      );
      return;
    }
    case "rebase": {
      const actions = [options.status, options.continue, options.abort].filter(Boolean);
      if (actions.length > 1) {
        throw new CliError("Choose only one of --status, --continue, or --abort.");
      }
      if (options.status) {
        const status = rebaseStatus();
        print(options.json ? status : formatRebaseStatus(status), options.json);
        return;
      }
      if (options.continue) {
        const result = continueRebase({ fork: options.fork });
        print(options.json ? result : formatRebaseResult(result), options.json);
        return;
      }
      if (options.abort) {
        const result = abortRebase();
        print(result, options.json);
        return;
      }
      const onto = requireValue(positionals[0], "vlab rebase <onto>");
      if (positionals.length > 1) {
        throw new CliError("Usage: vlab rebase <onto>");
      }
      const result = startRebase(onto, {
        acceptCandidates: options.acceptCandidates,
        forecastId: options.useForecast,
      });
      print(options.json ? result : formatRebaseResult(result), options.json);
      return;
    }
    case "forecast": {
      const source = requireValue(positionals[0], "vlab forecast <source>");
      const forecast = forecastReconciliation(source, {
        acceptCandidates: options.acceptCandidates,
      });
      print(options.json ? forecast : formatForecast(forecast), options.json);
      return;
    }
    case "reconcile": {
      const actions = [options.status, options.continue, options.abort].filter(Boolean);
      if (actions.length > 1) {
        throw new CliError("Choose only one of --status, --continue, or --abort.");
      }
      if (options.status) {
        const status = reconciliationStatus();
        print(options.json ? status : formatReconciliationStatus(status), options.json);
        return;
      }
      if (options.continue) {
        const result = continueReconciliation({ fork: options.fork });
        print(options.json ? result : formatReconciliationResult(result), options.json);
        return;
      }
      if (options.abort) {
        const result = abortReconciliation();
        print(result, options.json);
        return;
      }
      const source = requireValue(positionals[0], "vlab reconcile <source>");
      const result = reconcile(source, {
        acceptCandidates: options.acceptCandidates,
        forecastId: options.useForecast,
      });
      print(options.json ? result : formatReconciliationResult(result), options.json);
      return;
    }
    case "resolve": {
      const subcommand = positionals[0] ?? "status";
      if (subcommand === "status") {
        const result = pendingResolutionStatus();
        print(options.json ? result : formatResolutionStatus(result), options.json);
        return;
      }
      if (subcommand === "apply") {
        const result = applyResolution({
          path: positionals[1],
          all: options.all,
          resolutionId: options.resolution,
        });
        print(options.json ? result : formatResolutionAction(result, "applied"), options.json);
        return;
      }
      if (subcommand === "reject") {
        const result = rejectResolution({
          path: positionals[1],
          all: options.all,
          resolutionId: options.resolution,
        });
        print(options.json ? result : formatResolutionAction(result, "rejected"), options.json);
        return;
      }
      if (subcommand === "list") {
        const records = listResolutionRecords();
        print(options.json ? records : formatResolutionCatalog(records), options.json);
        return;
      }
      throw new CliError("Unknown resolve command. Use status, apply, reject, or list.");
    }
    case "cherry-pick": {
      const value = requireValue(positionals[0], "vlab cherry-pick <commit-or-change-id>");
      const result = cherryPick(value, { fork: options.fork, repeat: options.repeat });
      print(result, options.json);
      return;
    }
    case "graph": {
      const graph = runGit([
        "log",
        "--graph",
        "--oneline",
        "--decorate",
        "--branches",
        "--tags",
        "--remotes",
        "HEAD",
      ]).stdout;
      const records = listNoteRecords();
      print(`Project history\n${graph}\n\nCausal edges\n${formatCausalEdges(records)}`);
      return;
    }
    case "receipts": {
      const records = listNoteRecords();
      print(options.json ? records : formatReceipts(records), options.json);
      return;
    }
    case "metadata": {
      const subcommand = positionals[0];
      if (subcommand === "status") {
        const result = metadataStatus();
        print(options.json ? result : formatMetadataStatus(result), options.json);
        return;
      }
      if (subcommand === "validate") {
        const result = validateMetadata({ strict: options.strict });
        print(options.json ? result : formatMetadataStatus(result, "Metadata validation"), options.json);
        if (!result.summary.valid) process.exitCode = 1;
        return;
      }
      if (subcommand === "export") {
        const destination = requireValue(positionals[1], "vlab metadata export <directory>");
        const result = exportMetadata(destination);
        print(options.json ? result : formatMetadataTransfer(result), options.json);
        return;
      }
      if (subcommand === "import") {
        const source = requireValue(positionals[1], "vlab metadata import <directory> --dry-run|--apply");
        const result = importMetadata(source, {
          dryRun: options.dryRun,
          apply: options.apply,
        });
        print(options.json ? result : formatMetadataTransfer(result), options.json);
        if (!result.summary.applicable) process.exitCode = 1;
        return;
      }
      throw new CliError("Unknown metadata command. Use status, validate, export, or import.");
    }
    case "workspace": {
      const subcommand = positionals[0];
      if (subcommand === "create") {
        const name = requireValue(positionals[1], "vlab workspace create <name>");
        const workspace = createWorkspace(name, options);
        print(workspace, options.json);
        return;
      }
      if (subcommand === "list") {
        print(listWorkspaces(), true);
        return;
      }
      if (subcommand === "checkpoint") {
        const checkpoint = checkpointWorkspace(options.label);
        print(checkpoint, options.json);
        return;
      }
      if (subcommand === "move") {
        const name = requireValue(positionals[1], "vlab workspace move <name> <directory>");
        const destination = requireValue(
          positionals[2],
          "vlab workspace move <name> <directory>",
        );
        print(moveWorkspace(name, destination), options.json);
        return;
      }
      if (subcommand === "archive") {
        const name = requireValue(positionals[1], "vlab workspace archive <name>");
        print(archiveWorkspace(name), options.json);
        return;
      }
      if (subcommand === "restore") {
        const name = requireValue(positionals[1], "vlab workspace restore <name>");
        print(restoreWorkspace(name, { path: options.path }), options.json);
        return;
      }
      if (subcommand === "repair") {
        const name = requireValue(positionals[1], "vlab workspace repair <name> --path <directory>");
        const repairPath = requireValue(
          options.path,
          "vlab workspace repair <name> --path <directory>",
        );
        print(repairWorkspace(name, repairPath), options.json);
        return;
      }
      if (subcommand === "prune") {
        print(pruneWorkspaces({
          apply: options.apply,
          dryRun: options.dryRun,
        }), options.json);
        return;
      }
      if (subcommand === "forecast") {
        const target = requireValue(
          positionals[1],
          "vlab workspace forecast <target> <source>",
        );
        const source = requireValue(
          positionals[2],
          "vlab workspace forecast <target> <source>",
        );
        const forecast = forecastWorkspaces(target, source, {
          acceptCandidates: options.acceptCandidates,
          sourceCheckpoint: options.sourceCheckpoint,
        });
        print(options.json ? forecast : formatForecast(forecast), options.json);
        return;
      }
      throw new CliError(
        "Unknown workspace command. Use create, list, checkpoint, move, archive, restore, repair, prune, or forecast.",
      );
    }
    case "spec": {
      const subcommand = positionals[0];
      if (subcommand === "index") {
        if (options.all) {
          const result = indexAllSpecs(process.cwd(), { force: options.force });
          print(options.json ? result : formatSpecBatch(result), options.json);
          return;
        }
        const file = requireValue(positionals[1], "vlab spec index <file>");
        const result = indexSpec(file, process.cwd(), { force: options.force });
        print(options.json ? result : formatSpecResult(result), options.json);
        return;
      }
      if (subcommand === "show") {
        const file = requireValue(positionals[1], "vlab spec show <file>");
        print(readSpecManifest(file), true);
        return;
      }
      if (subcommand === "merge-plan") {
        const file = requireValue(
          positionals[1],
          "vlab spec merge-plan <file> <base> <ours> <theirs>",
        );
        const base = requireValue(positionals[2], "vlab spec merge-plan <file> <base> <ours> <theirs>");
        const ours = requireValue(positionals[3], "vlab spec merge-plan <file> <base> <ours> <theirs>");
        const theirs = requireValue(positionals[4], "vlab spec merge-plan <file> <base> <ours> <theirs>");
        const result = planSpecMerge(file, base, ours, theirs);
        print(options.json ? result : formatSpecMergePlan(result), options.json);
        return;
      }
      if (subcommand === "status") {
        const result = pendingSpecMergeStatus();
        print(options.json ? result : formatSpecMergeStatus(result), options.json);
        return;
      }
      if (subcommand === "resolve") {
        const result = applyPendingSpecMerges({
          path: positionals[1],
          all: options.all,
        });
        print(options.json ? result : formatSpecMergeAction(result), options.json);
        return;
      }
      if (subcommand === "benchmark") {
        const result = benchmarkSpecIndex({
          documents: options.documents,
          blocks: options.blocks,
        });
        print(result, true);
        return;
      }
      throw new CliError("Unknown spec command. Use index, show, merge-plan, status, resolve, or benchmark.");
    }
    case "doctor": {
      const git = runGit(["--version"]);
      const context = initLab();
      print({
        ok: true,
        git: git.stdout,
        node: process.version,
        repository: context.root,
        notesRef: "refs/notes/vcs-lab",
        benchmark: options.benchmark ? gitBenchmark(options) : undefined,
        objectSession: options.benchmark
          ? gitObjectSessionBenchmark(options, context.root)
          : undefined,
      }, true);
      return;
    }
    default:
      throw new CliError(`Unknown command '${command}'.\n\n${HELP}`);
  }
}
