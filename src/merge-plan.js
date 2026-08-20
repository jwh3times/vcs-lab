import {
  changeIdForCommit,
  commitSubject,
  currentHead,
  isAncestor,
  listCommits,
  mergeBase,
  resolveRevision,
  runGit,
  treeId,
} from "./git.js";
import { recordsReachableFrom } from "./notes.js";

function directChangeCoverage(ref, cwd) {
  const output = runGit(["rev-list", ref], { cwd }).stdout;
  const commits = output ? output.split(/\r?\n/).filter(Boolean) : [];
  const changeIds = new Set(commits.map((commit) => changeIdForCommit(commit, cwd)));
  return { commits: new Set(commits), changeIds };
}

function receiptCoverage(ref, cwd) {
  const receipts = recordsReachableFrom(ref, cwd).filter((record) =>
    ["landing", "reconciliation"].includes(record.type),
  );
  const commits = new Set();
  const changeIds = new Set();
  for (const receipt of receipts) {
    for (const commit of receipt.absorbedCommits ?? []) commits.add(commit);
    for (const changeId of receipt.absorbedChanges ?? []) changeIds.add(changeId);
  }
  return { receipts, commits, changeIds };
}

function patchCandidates(target, source, base, cwd) {
  const result = runGit(["cherry", target, source, base], {
    cwd,
    allowFailure: true,
  });
  const candidates = new Set();
  if (!result.ok || !result.stdout) return candidates;
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(-|\+)\s+([0-9a-f]+)/i);
    if (match?.[1] === "-") candidates.add(match[2]);
  }
  return candidates;
}

function chooseEffectiveBase(physicalBase, receipts, sourceHead, cwd) {
  let effective = physicalBase;
  let reason = "physical-ancestry";
  for (const receipt of receipts) {
    const candidate = receipt.sourceHead;
    if (!candidate || !isAncestor(candidate, sourceHead, cwd)) continue;
    if (isAncestor(effective, candidate, cwd)) {
      effective = candidate;
      reason = `causal-receipt:${receipt.id}`;
    }
  }
  return { commit: effective, reason };
}

export function buildMergePlan(sourceRef, cwd = process.cwd()) {
  const targetHead = currentHead(cwd);
  const sourceHead = resolveRevision(sourceRef, cwd);
  const physicalBase = mergeBase(targetHead, sourceHead, cwd);
  const targetTree = treeId(targetHead, cwd);
  const sourceTree = treeId(sourceHead, cwd);
  const exactStateEquality = targetTree === sourceTree;

  const direct = directChangeCoverage(targetHead, cwd);
  const receipt = receiptCoverage(targetHead, cwd);
  const candidates = patchCandidates(targetHead, sourceHead, physicalBase, cwd);
  const sourceCommits = listCommits(physicalBase, sourceHead, cwd);
  const effectiveBase = chooseEffectiveBase(
    physicalBase,
    receipt.receipts,
    sourceHead,
    cwd,
  );

  const changes = sourceCommits.map((commit) => {
    const changeId = changeIdForCommit(commit, cwd);
    let status = "new";
    let proof = null;
    if (direct.commits.has(commit)) {
      status = "covered";
      proof = "commit-ancestry";
    } else if (receipt.commits.has(commit)) {
      status = "covered";
      proof = "signed-shaped-landing-receipt";
    } else if (direct.changeIds.has(changeId)) {
      status = "covered";
      proof = "stable-change-id";
    } else if (receipt.changeIds.has(changeId)) {
      status = "covered";
      proof = "receipt-change-id";
    } else if (candidates.has(commit)) {
      status = "candidate-equivalent";
      proof = "git-patch-id-heuristic";
    }
    return {
      commit,
      shortCommit: commit.slice(0, 12),
      changeId,
      subject: commitSubject(commit, cwd),
      status,
      proof,
    };
  });

  const counts = changes.reduce(
    (summary, change) => {
      summary[change.status] = (summary[change.status] ?? 0) + 1;
      return summary;
    },
    { covered: 0, "candidate-equivalent": 0, new: 0 },
  );

  return {
    schema: "vcs-lab.merge-plan/v1",
    targetHead,
    sourceRef,
    sourceHead,
    targetTree,
    sourceTree,
    exactStateEquality,
    physicalBase,
    effectiveBase,
    reachableReceipts: receipt.receipts.map((item) => item.id),
    counts,
    changes,
  };
}

export function formatMergePlan(plan) {
  const lines = [
    `target       ${plan.targetHead.slice(0, 12)}`,
    `source       ${plan.sourceRef} (${plan.sourceHead.slice(0, 12)})`,
    `physical base ${plan.physicalBase.slice(0, 12)}`,
    `effective base ${plan.effectiveBase.commit.slice(0, 12)} (${plan.effectiveBase.reason})`,
    `same state   ${plan.exactStateEquality ? "yes" : "no"}`,
    "",
  ];

  if (plan.changes.length === 0) {
    lines.push("No source changes are outside the physical ancestry.");
  } else {
    for (const change of plan.changes) {
      const marker =
        change.status === "covered"
          ? "="
          : change.status === "candidate-equivalent"
            ? "?"
            : "+";
      const proof = change.proof ? ` [${change.proof}]` : "";
      lines.push(
        `${marker} ${change.shortCommit} ${change.changeId} ${change.subject}${proof}`,
      );
    }
  }

  lines.push(
    "",
    `summary      ${plan.counts.covered} covered, ${plan.counts["candidate-equivalent"]} candidate, ${plan.counts.new} new`,
  );
  if (plan.counts["candidate-equivalent"] > 0) {
    lines.push("Candidates are advisory and are never silently suppressed.");
  }
  return lines.join("\n");
}
