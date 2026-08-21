import {
  isAncestor,
  mergeBase,
  resolveObjectIds,
  runGit,
  withGitObjectSession,
} from "./git.js";
import { recordsReachableFrom } from "./notes.js";
import { acceptedCausalRecords } from "./metadata.js";

function parseHistory(output) {
  const records = [];
  const fields = output.split("\0");
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const commit = fields[index].trim();
    if (!commit) continue;
    records.push({
      commit,
      subject: fields[index + 1],
      message: fields[index + 2],
    });
  }
  return records;
}

function directChangeCoverage(ref, cwd) {
  const output = runGit(
    ["log", "-z", ref, "--format=%H%x00%s%x00%B"],
    { cwd, trim: false },
  ).stdout;
  const history = parseHistory(output);
  return {
    commits: new Set(history.map((item) => item.commit)),
    changeIds: new Set(
      history.map((item) =>
        extractChangeId(item.commit, item.message),
      ),
    ),
  };
}

function extractChangeId(commit, message) {
  const match = message.match(/^Change-Id:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() ?? `git:${commit}`;
}

function receiptCoverage(ref, directCommits, cwd) {
  const receipts = acceptedCausalRecords(
    recordsReachableFrom(ref, cwd, directCommits).filter((record) =>
      ["landing", "reconciliation", "rebase"].includes(record.type),
    ),
    cwd,
  );
  const commits = new Set();
  const changeIds = new Set();
  for (const receipt of receipts) {
    for (const commit of receipt.absorbedCommits ?? []) commits.add(commit);
    for (const changeId of receipt.absorbedChanges ?? []) changeIds.add(changeId);
  }
  return { receipts, commits, changeIds };
}

function sourceChanges(base, source, cwd) {
  const output = runGit(
    ["log", "-z", "--reverse", "--format=%H%x00%s%x00%B", `${base}..${source}`],
    { cwd, trim: false },
  ).stdout;
  return parseHistory(output).map((item) => ({
    ...item,
    changeId: extractChangeId(item.commit, item.message),
  }));
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

function buildMergePlanInSession(targetRef, sourceRef, cwd) {
  const [targetHead, sourceHead] = resolveObjectIds(
    [`${targetRef}^{commit}`, `${sourceRef}^{commit}`],
    cwd,
  );
  const physicalBase = mergeBase(targetHead, sourceHead, cwd);
  const [targetTree, sourceTree] = resolveObjectIds(
    [`${targetHead}^{tree}`, `${sourceHead}^{tree}`],
    cwd,
  );
  const exactStateEquality = targetTree === sourceTree;

  const direct = directChangeCoverage(targetHead, cwd);
  const receipt = receiptCoverage(targetHead, direct.commits, cwd);
  const candidates = patchCandidates(targetHead, sourceHead, physicalBase, cwd);
  const sourceHistory = sourceChanges(physicalBase, sourceHead, cwd);
  const effectiveBase = chooseEffectiveBase(
    physicalBase,
    receipt.receipts,
    sourceHead,
    cwd,
  );

  const changes = sourceHistory.map(({ commit, changeId, subject }) => {
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
      subject,
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

export function buildMergePlan(sourceRef, cwd = process.cwd()) {
  return buildMergePlanBetween("HEAD", sourceRef, cwd);
}

export function buildMergePlanBetween(targetRef, sourceRef, cwd = process.cwd()) {
  return withGitObjectSession(cwd, () =>
    buildMergePlanInSession(targetRef, sourceRef, cwd),
  );
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
