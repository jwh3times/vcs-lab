import { sha256 } from "./ids.js";
import { canonicalJson } from "./canonical-json.js";
import { CliError } from "./errors.js";
import { repositoryLineage } from "./metadata.js";
import { buildMergePlan, coverageEvidence } from "./merge-plan.js";
import { currentHead, resolveObjectIds } from "./engine.js";

export const PROOF_BUNDLE_SCHEMA = "vcs-lab.proof-bundle/v1";

/**
 * The coverage proof lattice, restated as data a verifier can apply without
 * running the planner. Order is precedence: the first rule whose evidence
 * holds decides the classification, exactly as `buildMergePlan` evaluates it.
 *
 * Keeping the rules here rather than importing the planner's branch is the
 * point of the exercise (FR-PLAN-08): a verifier that shares the planner's
 * code proves only that the code is self-consistent. This table is applied to
 * the bundle's own evidence and the result compared with what the planner
 * claimed, so a doctored `proof` or `status` field is caught.
 */
export const PROOF_RULES = [
  {
    proof: "commit-ancestry",
    status: "covered",
    holds: (change, evidence) => evidence.targetCommits.has(change.commit),
    describe: (change) => ({ kind: "target-commit", commit: change.commit }),
  },
  {
    proof: "receipt-commit",
    status: "covered",
    holds: (change, evidence) => evidence.receiptCommits.has(change.commit),
    describe: (change, evidence) => ({
      kind: "receipt-absorbed-commit",
      commit: change.commit,
      receipts: evidence.receiptsClaimingCommit(change.commit),
    }),
  },
  {
    proof: "stable-change-id",
    status: "covered",
    holds: (change, evidence) => evidence.targetChangeIds.has(change.changeId),
    describe: (change) => ({ kind: "target-change-id", changeId: change.changeId }),
  },
  {
    proof: "receipt-change-id",
    status: "covered",
    holds: (change, evidence) => evidence.receiptChangeIds.has(change.changeId),
    describe: (change, evidence) => ({
      kind: "receipt-absorbed-change-id",
      changeId: change.changeId,
      receipts: evidence.receiptsClaimingChangeId(change.changeId),
    }),
  },
  {
    proof: "git-patch-id-heuristic",
    status: "candidate-equivalent",
    holds: (change, evidence) => evidence.patchEquivalentCommits.has(change.commit),
    describe: (change) => ({ kind: "patch-equivalent", commit: change.commit }),
  },
];

/** Index the bundle's evidence arrays for rule evaluation. */
function indexEvidence(evidence) {
  const receipts = evidence.receipts ?? [];
  return {
    targetCommits: new Set(evidence.targetCommits ?? []),
    targetChangeIds: new Set(evidence.targetChangeIds ?? []),
    receiptCommits: new Set(receipts.flatMap((r) => r.absorbedCommits ?? [])),
    receiptChangeIds: new Set(receipts.flatMap((r) => r.absorbedChanges ?? [])),
    patchEquivalentCommits: new Set(evidence.patchEquivalentCommits ?? []),
    receiptsClaimingCommit: (commit) =>
      receipts.filter((r) => (r.absorbedCommits ?? []).includes(commit)).map((r) => r.id),
    receiptsClaimingChangeId: (changeId) =>
      receipts.filter((r) => (r.absorbedChanges ?? []).includes(changeId)).map((r) => r.id),
  };
}

/**
 * Apply the lattice to one change. Returns the classification and the specific
 * evidence that produced it, which is what the plan's bare `proof` string
 * cannot give a reader: not only that a receipt covered this commit, but which
 * receipt claimed it.
 */
export function classifyFromEvidence(change, indexed) {
  for (const rule of PROOF_RULES) {
    if (rule.holds(change, indexed)) {
      return {
        status: rule.status,
        proof: rule.proof,
        evidence: rule.describe(change, indexed),
      };
    }
  }
  return { status: "new", proof: null, evidence: { kind: "none" } };
}

/** The bundle's hash covers everything except its own `integrity` member. */
export function bundleHash(bundle) {
  const { integrity, signatures, ...payload } = bundle;
  return sha256(canonicalJson(payload));
}

/**
 * Build a portable proof bundle for `sourceRef` against the current target
 * (FR-PLAN-08). The bundle carries the classification *and the evidence it was
 * derived from*, so a third party can recompute the classification instead of
 * trusting it, and can check the evidence against the repository when they
 * have one.
 */
export function buildProofBundle(sourceRef, cwd = process.cwd()) {
  const plan = buildMergePlan(sourceRef, cwd);
  const evidence = coverageEvidence(sourceRef, cwd);
  const bundle = {
    schema: PROOF_BUNDLE_SCHEMA,
    repository: {
      lineage: repositoryLineage(cwd),
    },
    target: { head: plan.targetHead },
    source: { ref: plan.sourceRef, head: plan.sourceHead },
    physicalBase: plan.physicalBase,
    effectiveBase: plan.effectiveBase,
    evidence,
    changes: plan.changes.map((change) => ({
      commit: change.commit,
      changeId: change.changeId,
      subject: change.subject,
      status: change.status,
      proof: change.proof,
    })),
    counts: plan.counts,
  };
  bundle.integrity = { algorithm: "sha256", bundleHash: bundleHash(bundle) };
  return bundle;
}

/**
 * Check the bundle's evidence against a real repository, which is the only
 * check that can catch **fabricated** evidence. Recomputing the classification
 * proves a plan follows from what it states; it cannot notice that a stated
 * receipt never existed. This recomputes the evidence from the repository and
 * compares it byte for byte under the canonical JSON profile.
 *
 * A repository that has moved on since the bundle was produced is reported as
 * `skipped`, not as a failure: different heads legitimately produce different
 * evidence, and calling that tampering would cry wolf.
 */
export function verifyAgainstRepository(bundle, cwd = process.cwd()) {
  const claimedTarget = bundle?.target?.head ?? null;
  const claimedSource = bundle?.source?.head ?? null;
  const sourceRef = bundle?.source?.ref ?? null;
  if (!claimedTarget || !claimedSource || !sourceRef) {
    return { checked: false, reason: "bundle-incomplete", matches: null };
  }
  const head = currentHead(cwd);
  if (head !== claimedTarget) {
    return {
      checked: false,
      reason: "target-moved",
      matches: null,
      claimedTarget,
      repositoryTarget: head,
    };
  }
  let repositorySource;
  try {
    [repositorySource] = resolveObjectIds([`${sourceRef}^{commit}`], cwd);
  } catch {
    return { checked: false, reason: "source-ref-missing", matches: null, sourceRef };
  }
  if (repositorySource !== claimedSource) {
    return {
      checked: false,
      reason: "source-moved",
      matches: null,
      claimedSource,
      repositorySource,
    };
  }
  const actual = coverageEvidence(sourceRef, cwd);
  const matches = canonicalJson(actual) === canonicalJson(bundle.evidence ?? {});
  return {
    checked: true,
    reason: null,
    matches,
    evidenceHash: {
      claimed: sha256(canonicalJson(bundle.evidence ?? {})),
      repository: sha256(canonicalJson(actual)),
    },
  };
}

/**
 * Verify a bundle. Two independent checks, reported separately because they
 * answer different questions:
 *
 * - **integrity**: the bundle's own hash still matches its contents, so nothing
 *   was edited after it was produced.
 * - **classification**: re-deriving every change from the bundle's evidence
 *   reproduces the status and proof it claims. This catches a doctored `proof`
 *   or `status`, and it is the check FR-PLAN-08 asks for.
 *
 * Neither check can tell whether the *evidence itself* is truthful — a bundle
 * could state receipts that do not exist. That requires the repository, and is
 * what `verifyAgainstRepository` adds.
 */
export function verifyProofBundle(bundle, repository = null) {
  if (bundle?.schema !== PROOF_BUNDLE_SCHEMA) {
    throw new CliError(
      `Not a ${PROOF_BUNDLE_SCHEMA} document (found ${JSON.stringify(bundle?.schema ?? null)}).`,
    );
  }
  const expected = bundle.integrity?.bundleHash ?? null;
  const actual = bundleHash(bundle);
  const indexed = indexEvidence(bundle.evidence ?? {});
  const disagreements = [];
  for (const change of bundle.changes ?? []) {
    const recomputed = classifyFromEvidence(change, indexed);
    if (recomputed.status !== change.status || recomputed.proof !== change.proof) {
      disagreements.push({
        commit: change.commit,
        changeId: change.changeId,
        claimed: { status: change.status, proof: change.proof },
        recomputed: { status: recomputed.status, proof: recomputed.proof },
      });
    }
  }
  return {
    schema: "vcs-lab.proof-verification/v1",
    bundleSchema: bundle.schema,
    integrity: {
      algorithm: bundle.integrity?.algorithm ?? null,
      claimed: expected,
      computed: actual,
      intact: expected === actual,
    },
    classification: {
      changes: (bundle.changes ?? []).length,
      reproduced: (bundle.changes ?? []).length - disagreements.length,
      disagreements,
      agrees: disagreements.length === 0,
    },
    repository: repository ?? { checked: false, reason: "not-requested", matches: null },
    trust: {
      evidenceCheckedAgainstRepository: Boolean(repository?.checked),
      statement: repository?.checked
        ? "The classification was recomputed from the bundle's evidence, and " +
          "that evidence was compared with the repository."
        : "Recomputing the classification from the bundle's own evidence proves " +
          "the plan follows from what it states, not that the evidence is true. " +
          "Checking the evidence against a repository is a separate step.",
    },
    ok:
      expected === actual &&
      disagreements.length === 0 &&
      repository?.matches !== false,
  };
}
