# Roadmap

## Document status

| Field | Value |
| --- | --- |
| Baseline | v0.9.0 released |
| Status | Maintained execution guide |
| Last reviewed | 2026-08-27 |
| Planning horizon | Next bounded increment through native-implementation gate |

This roadmap synthesizes the current
[product requirements](product.md), [architecture](architecture.md),
[testing contract](testing.md), [changelog](../CHANGELOG.md), and accepted
[architecture decisions](adr/README.md). It orders work; it does not replace
those authorities. A version number is not a commitment until its scope is
accepted in an issue, pull request, or ADR.

Roadmap states mean:

- **Delivered:** included in a tagged release.
- **Implemented, unreleased:** present in the current development baseline and
  covered by tests, but still under `CHANGELOG.md`'s `Unreleased` section.
- **Next:** supported by current evidence and ready for a bounded implementation
  brief.
- **Candidate:** useful expansion whose contract or priority still needs to be
  accepted.
- **Gated:** must not begin until its stated evidence or design gate is met.

## Current position

The laboratory has already tested the core causal model over ordinary Git.
v0.9.0 releases the causal-rebase, workspace-lifecycle, checkpoint-forecast,
scale-benchmark, and scan-batching work accumulated since v0.8.0.

| Area | Status | Current result |
| --- | --- | --- |
| Stable change identity and causal landing | Delivered | Change IDs survive supported rewrites; compact merges retain ancestry; hard squashes carry exact absorbed-work receipts. |
| Proof-aware planning and reconciliation | Delivered | Plans distinguish exact coverage, advisory candidates, and new work; reconciliation is forecastable, resumable, and abortable. |
| Exact and deterministic resolution | Delivered | Exact conflict results can be reused with explicit approval; indexed Markdown supports conservative deterministic section merges. |
| Workspaces and checkpoints | Delivered | Linked-worktree isolation, non-disruptive checkpoints, move/archive/restore/repair/prune, and immutable source-checkpoint forecasts are released. |
| Metadata integrity and portability | Delivered in v0.8 | Accepted shared facts can be inventoried, quarantined, exported, validated, and imported idempotently between related clones. |
| Causal rebase | Delivered | Linear current-branch planning, isolated forecasting, supervised replay, recovery, identity handling, and portable completed receipts are integration-tested and released. |
| Scale evidence and scan batching | Delivered | A synthetic repository fixture identified workspace-status and resolution-catalog process amplification; the selected invocation-local batching is implemented and the rerun shows one process per workspace and six for the resolution catalog. Nothing justifies an index or service. |
| Trust, remote protocol, and native storage | Gated | Integrity exists, but signatures, authorization, capability negotiation, trusted landing, and a native store are intentionally absent. |

The first pending work is therefore qualification and release of existing
semantics plus broader evidence, not another storage layer or service.

## Horizon 1: close the current development line

### 1. Batch the measured scan hot paths

**Status: delivered in v0.9.0.** The bounded action selected by
[ADR-0013](adr/0013-measure-scan-amplification-before-adding-indexes-or-a-service.md)
and tracked by
[GitHub issue #1](https://github.com/jwh3times/vcs-lab/issues/1) was:

1. Replace the three-process inspection of each active workspace with a
   worktree-scoped status query that preserves exact head, dirty count,
   lifecycle, and missing-versus-invalid path semantics.
2. Discover resolution refs and object IDs in one bounded scan, join them to
   batched note/object reads, and preserve signature, attachment, retained-blob,
   quarantine, deletion, and deterministic-order rules.
3. Keep domain JSON semantically unchanged except for measurement and decision
   fields.
4. Prove equality with the existing path in ordinary and forced Git-session
   modes.

Exit criteria:

- workspace status uses at most one median Git process per active workspace in
  the representative fixture;
- the 50-resolution fixture uses a single-digit number of Git processes unless
  a documented compatibility constraint prevents it;
- active, dirty, archived, missing, and invalid workspaces are covered;
- valid, deleted, malformed, mismatched, and multiply ordered resolution
  records are covered; and
- caller state, privacy, quarantine, and failure behavior remain unchanged.

The Linux rerun meets these criteria: 12 processes for 12 workspaces, six
processes for 50 resolutions, identical semantic results in both Git-session
modes, and unchanged caller state. This closes the only optimization that
current measurements directly select. It addresses FR-WS-09 and provides the
next decision point for FR-PERF-09.

### 2. Rerun the accepted evidence schema

Rerun `vcs-lab.repository-scale-benchmark/v1` without changing the fixture or
measurement meaning. Compare pre/post process counts, semantic results, median,
and p95 for workspace status, resolution catalog, and complete metadata status.
The Linux before/after comparison is recorded in ADR-0013; the Windows host
that produced the initial evidence still needs the same rerun.

If both paths fall under the configured budget, stop optimizing them and gather
larger real-repository and multi-host evidence. If an already-batched path
remains over budget, propose an incremental catalog in a new ADR. One synthetic
host result must not recommend a daemon or fixed production target.

### 3. Qualify and release the accumulated v0.9 work

**Status: v0.9.0 released on 2026-08-27** after the full
[release gate](testing.md#release-gate) passed on a Linux host; the Windows
rerun of the scale benchmark remains a follow-on evidence step. The gate is:

- ordinary and forced-session integration suites;
- all maintained demonstrations;
- strict metadata validation and expected-failure safety checks;
- broad JavaScript syntax and documentation-link checks;
- process-cleanliness checks; and
- package/version/changelog/tag alignment plus an out-of-tree artifact smoke
  test.

The release summary should distinguish the already implemented causal-rebase,
workspace-lifecycle, checkpoint-forecast, and scale-benchmark work from the
new scan batching. Representative non-Windows and real-repository performance
evidence is a follow-on architecture gate, not a production claim implied by
the release.

## Horizon 2: harden and publish the local contracts

These items make the implemented laboratory easier to integrate and safer to
extend. They should precede a remote protocol or trust layer.

### 1. Publish machine-readable contracts

- Create a versioned CLI output/schema catalog to complete FR-GIT-06.
- Publish standalone JSON Schema documents for persisted and automation-facing
  records while retaining executable validators as the runtime authority.
- Define compatibility, migration, resource-bound, and unknown-version behavior
  for every shared, local, and worktree-private record family.
- Add conformance fixtures that verify human/JSON parity for state required by
  automation.

### 2. Strengthen identity and proof diagnostics

- Add repository-wide Change-ID collision and duplicate-origin-chain audits
  for FR-ID-06.
- Specify Change-ID namespace, entropy, and cross-repository import behavior for
  FR-ID-07 before IDs participate in any trust decision.
- Replace or version the historical `signed-shaped-landing-receipt` proof label
  so integrity-linked local evidence is never confused with a signature.
- Define a portable proof bundle and independent classification verifier for
  FR-PLAN-08 after the schema catalog is stable.

### 3. Exercise failure and hostile-input boundaries

- Add systematic kill/fault injection between each Git mutation, journal write,
  ref publication, and cleanup edge.
- Fuzz malformed notes, manifests, envelopes, ref names, paths, object formats,
  and bounded-buffer limits using disposable repositories.
- Verify exact recovery or fail-closed diagnostics for out-of-band Git
  continue/skip/abort actions.
- Add representative Windows and POSIX runs, including large-object fallback
  and OneDrive/path-edge cases.

Exit criteria for this horizon are published schemas, deterministic audit
output, migration/conformance coverage, and fault tests showing that no partial
receipt or unsafe ref survives an interrupted operation.

## Horizon 3: expand workflows one contract at a time

The following are candidates, not one combined release. Each needs an accepted
contract and focused disposable-repository evidence.

### Workspace and rebase expansion

Recommended order:

1. Define target-checkpoint forecast semantics, including target overlay
   identity, approval, staleness, abort, and whether application may mutate the
   committed target.
2. Generalize causal rebase to explicit linear ranges while retaining exact
   origin/result mappings and unexpected-empty blocking.
3. Add checkpoint/draft inputs to rebase only after their forecast and
   publication semantics are settled.
4. Design merge-preserving rebase with explicit mapping for recreated merge
   commits and causal receipts.
5. Treat edit, reword, squash, and fixup as distinct interactive identity
   decisions rather than inheriting Git's sequencer behavior implicitly.

Live dirty bytes must not be forecast as stable causal state. Native private
draft stacks without a compatibility branch remain deferred under FR-WS-08
until a storage/protocol contract justifies them.

### Structured-document expansion

- Build a shared semantic-merge conformance suite before adding another format
  under FR-SPEC-13.
- Evaluate nested requirement-level merge as a new parser/merge version; do not
  silently change v1 heading-section boundaries.
- Require every adapter to define canonical bytes, entities, identity,
  deterministic rules, blockers, migrations, and sparse storage behavior.

### Lower-confidence resolution experiments

FR-RES-07 may be explored only as a visibly separate confidence tier with
provenance, pinned inputs, explicit review, and no ability to masquerade as an
exact or deterministic decision. Model-generated results must never weaken the
current ambiguity and approval rules.

## Horizon 4: remote verification, trust, and coordinated landing

This horizon depends on the schema, identity, proof-bundle, and hostile-input
work above. Its order is deliberate:

1. **Portable verification:** independently reproduce plan classification from
   a versioned proof bundle without trusting CLI prose.
2. **Capability negotiation:** define a narrow remote gateway that advertises
   schemas, algorithms, object format, lineage, and optional features for
   FR-PROTO-06 while retaining offline envelope inspection.
3. **Actor trust:** design signed envelopes with explicit issuer identity, key
   rotation, replay protection, revocation, and authorization scope for
   FR-TRUST-02.
4. **Policy and publication:** only then consider a trusted landing coordinator
   that evaluates policy and atomically publishes Git and causal refs for
   FR-LAND-10 and FR-TRUST-03.

Integrity, signature validity, actor authorization, and landing policy must
remain separate results. Remote metadata conflicts must never overwrite local
facts silently.

## Horizon 5: decide whether a native subsystem is warranted

No native database, resident service, or replacement protocol is currently
approved. Use this decision sequence:

| Evidence | Permitted next step |
| --- | --- |
| A path launches per-entity Git processes | Batch within the invocation. |
| An already-batched path exceeds a representative budget | Propose an incremental catalog with lifecycle, migration, and equality tests. |
| Cross-command cost remains material on representative Windows and POSIX repositories after justified catalogs | Propose a resident-service ADR covering ownership, locking, security, crash recovery, upgrade, shutdown, and fallback. |
| Git-backed metadata portability or semantics cannot meet the PRD's native-implementation criteria | Prototype a native store/protocol behind the existing observable contracts, with Git as oracle and escape hatch. |

Evidence must also show user value: receipts prevent real duplicate work,
forecasts reproduce applied trees, workspace/checkpoint flows improve parallel
work, resolution reuse avoids repeated effort safely, and semantic identity
helps real document corpora. Performance alone is insufficient.

## Requirement backlog

This table is the compact trace from incomplete PRD requirements to the
roadmap. The PRD remains authoritative for exact wording and acceptance
signals.

| Requirement | Current state | Roadmap destination |
| --- | --- | --- |
| FR-GIT-06 | Partial | Horizon 2 schema and CLI contract catalog |
| FR-ID-06, FR-ID-07 | Planned | Horizon 2 identity/proof diagnostics |
| FR-LAND-10 | Deferred | Horizon 4 trusted coordinated landing |
| FR-PLAN-08 | Planned | Horizons 2 and 4 portable verification |
| FR-RES-07 | Planned | Horizon 3 isolated lower-confidence experiments |
| FR-WS-08 | Deferred | Horizon 5 native-subsystem gate |
| FR-WS-09 | Batched status implemented; multi-host evidence pending | Horizon 1 rerun on Windows, larger fixtures, and real repositories |
| FR-SPEC-13 | Planned | Horizon 3 adapter conformance and expansion |
| FR-PERF-09 | Evidence gate | Horizons 1 and 5 measurement decision |
| FR-PROTO-06 | Deferred | Horizon 4 capability negotiation |
| FR-TRUST-02, FR-TRUST-03 | Deferred | Horizon 4 actor trust and policy publication |

The following experimentally implemented requirements still need continued
real-world and cross-platform evidence rather than new semantics: FR-GIT-08,
FR-LAND-09, FR-REC-12, FR-RES-08, FR-WS-07, FR-PERF-10, and FR-PROTO-04.

## Decision backlog

Resolve these questions only when the adjacent roadmap work creates evidence:

- Define whether history-filtered imports can establish lineage without a
  shared root before changing envelope v1's fail-closed rule.
- Define merge/conflict policy for competing causal facts before remote sync.
- Select repository-scoped, global, or issuer-qualified Change IDs together
  with the identity and trust contracts.
- Validate that target-context causal rebase remains understandable before
  broadening beyond linear v1.
- Define target overlay approval before adding target checkpoints.
- Ratify representative budgets before considering catalogs or a service.
- Use real corpus evidence to choose future structured formats and whether spec
  identity should remain a tracked sidecar.
- Define causal-history compaction only with an auditability and old-plan
  compatibility story.

## Continuous quality rules

Every horizon inherits the accepted invariants:

- Git remains valid, inspectable, and recoverable without `vlab`.
- Exact proof stays distinct from heuristic similarity and trust.
- Broad mutation is forecastable, pinned, resumable, or exactly abortable.
- Worktree-private state never leaks across linked worktrees.
- Completed shared facts publish only after whole-operation success.
- Optimizations preserve plans, decisions, trees, receipts, and failure safety.
- New schemas, algorithms, persistence scopes, or migrations receive an ADR
  where they change a durable decision and integration coverage where they
  change observable behavior.

Until the relevant gates are met, the roadmap explicitly excludes a daemon,
database, automatic remote synchronization, cryptographic trust claims, live
dirty-byte forecasting, automatic AI conflict resolution, and a production VCS
claim.
