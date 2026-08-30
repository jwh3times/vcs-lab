# Roadmap

## Document status

| Field | Value |
| --- | --- |
| Baseline | v0.9.0 released |
| Status | Maintained execution guide |
| Last reviewed | 2026-08-29 |
| Planning horizon | Next bounded increment through the phased native-core program |

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
scale-benchmark, and scan-batching work accumulated since v0.8.0. On 2026-08-28
[ADR-0014](adr/0014-split-the-native-implementation-gate-into-engine-and-store-gates.md)
split the native implementation gate and
[ADR-0015](adr/0015-adopt-a-phased-native-core-program-with-rust.md) adopted a
phased native-core program with Rust as the core language, entering only after
a Git-native first increment.

| Area | Status | Current result |
| --- | --- | --- |
| Stable change identity and causal landing | Delivered | Change IDs survive supported rewrites; compact merges retain ancestry; hard squashes carry exact absorbed-work receipts. |
| Proof-aware planning and reconciliation | Delivered | Plans distinguish exact coverage, advisory candidates, and new work; reconciliation is forecastable, resumable, and abortable. |
| Exact and deterministic resolution | Delivered | Exact conflict results can be reused with explicit approval; indexed Markdown supports conservative deterministic section merges. |
| Workspaces and checkpoints | Delivered | Linked-worktree isolation, non-disruptive checkpoints, move/archive/restore/repair/prune, and immutable source-checkpoint forecasts are released. |
| Metadata integrity and portability | Delivered in v0.8 | Accepted shared facts can be inventoried, quarantined, exported, validated, and imported idempotently between related clones. |
| Causal rebase | Delivered | Linear current-branch planning, isolated forecasting, supervised replay, recovery, identity handling, and portable completed receipts are integration-tested and released. |
| Scale evidence and scan batching | Delivered | A synthetic repository fixture identified workspace-status and resolution-catalog process amplification; the selected invocation-local batching is implemented and the Linux and Windows reruns show one process per workspace and six for the resolution catalog, with every phase under the interactive budget on both hosts. Nothing justifies an index or service. |
| Trust, remote protocol, and native storage | Gated | Integrity exists, but signatures, authorization, capability negotiation, trusted landing, and a native store are intentionally absent. |

Horizon 1.5's first two items are delivered on the Windows host: clean
forecast steps run through a `git merge-tree` session behind a flag
([ADR-0016](adr/0016-simulate-clean-forecast-steps-with-a-merge-tree-session.md))
and the Windows post-batching rerun is recorded in ADR-0013. The first pending
work is therefore the POSIX differential run of the merge-tree engine, then
the contract catalog and engine seam that Gate A requires; no storage layer or
service is approved.

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

**Status: delivered on both hosts.** `vcs-lab.repository-scale-benchmark/v1`
was rerun without changing the fixture or measurement meaning. The Linux
before/after comparison and the 2026-08-29 Windows rerun (tracked by
[GitHub issue #2](https://github.com/jwh3times/vcs-lab/issues/2)) are recorded
in ADR-0013: on Windows the workspace-status median fell from 1,598 ms to
410 ms and the resolution-catalog median from 5,504 ms to 254 ms, with
identical semantic results in ordinary and forced-session modes and no phase
over the 1,000 ms budget.

Both paths fall under the configured budget on both hosts, so Horizon 1
optimization stops here; the next evidence is larger real-repository and
multi-host measurement. One synthetic host result must not recommend a daemon
or fixed production target. The under-budget results neither satisfy nor
block Gate A of ADR-0014, which needs a named Windows/OneDrive budget that the
batched path misses, measured against Git's best mode (Horizon 1.5); no such
budget has been named yet.

### 3. Qualify and release the accumulated v0.9 work

**Status: v0.9.0 released on 2026-08-27** after the full
[release gate](testing.md#release-gate) passed on a Linux host; the Windows
rerun of the scale benchmark followed on 2026-08-29 (item 2). The gate is:

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

## Horizon 1.5: Git-native wins before native code

Program phase 0a of ADR-0015. Exhaust what stock Git already offers, so every
later native claim is measured against Git's best mode rather than against the
current `vlab` path:

1. **Done 2026-08-29 (ADR-0016):** simulate clean forecast steps with one
   `git merge-tree --stdin` session behind `VLAB_FORECAST_ENGINE` /
   `--forecast-engine`, falling back to the temporary-worktree simulator when
   a step conflicts, is empty, or a resolution or Markdown driver must run;
   pin per-step and predicted trees exactly as `vcs-lab.forecast/v2` and
   `vcs-lab.rebase-forecast/v1` do today; `git replay` evaluated and not
   adopted; `rerere` interaction documented and closed by
   [ADR-0018](adr/0018-disable-git-rerere-inside-vlab-picks-and-landing-merges.md), which disables rerere inside vlab's picks and
   landing merges.
2. **Done 2026-08-29:** the Windows post-batching rerun of
   `vcs-lab.repository-scale-benchmark/v1` is recorded in ADR-0013's Windows
   post-batching evidence section.
3. Optionally enable commit-graph, multi-pack index, and fsmonitor in
   `vlab init`, and derive sparse-checkout cones from workspace focus, with
   workspace-creation and materialized-bytes phases added to a v2 benchmark
   profile.

Exit criteria: predicted and per-step trees are byte-identical between the two
simulators on the whole suite in both session modes; the 12-change demo
forecast uses a single-digit Git process count with no temporary worktree;
divergences are documented as Git constraints with the flag off for those
cases; the Windows post-batching rerun and the Git-best-mode baseline are
recorded (ADR-0014 Gate A item 2); the supported Git baseline is 2.40. This
horizon needs no new language and is reversible by flag.

Status on 2026-08-29: the suite and the 12-change demo pin byte-identical
trees across engines in both session modes on the Windows host; the demo
forecast uses nine Git processes inside the forecast (ten for the command)
with no temporary worktree; the divergences found are recorded as Git
constraints in ADR-0016 (the engine needs Git 2.49 and falls back below it);
the Windows rerun is recorded. The POSIX differential
run and the POSIX process/time deltas are the remaining evidence, tracked on
[GitHub issue #3](https://github.com/jwh3times/vcs-lab/issues/3); the default
engine stays `worktree` until both hosts have reported.

## Horizon 2: harden and publish the local contracts

These items make the implemented laboratory easier to integrate and safer to
extend. They should precede a remote protocol or trust layer.

### 1. Publish machine-readable contracts

Program phase 0b of ADR-0015 and Gate A item 1 of ADR-0014.

- Create a versioned CLI output/schema catalog to complete FR-GIT-06.
- Freeze an RFC 8785 canonical-JSON profile with shared test vectors that
  reserve signature and repository-identity fields.
- Introduce a single read-side engine seam (`src/engine.js`) with an engine
  selector, a third integration-suite mode, a differential doctor mode, and
  `engine`/`fallbacks` fields in metrics.
- Exit criteria for program phase 0b: the suite passes in ordinary,
  forced-session, and passthrough-native modes; no domain module calls
  `runGit` for reads directly; Gate A item 1 is satisfied and item 2 is
  carried from Horizon 1.5; the phase 1 ADR names the Gate A item 3 budget
  from those runs before any phase 1 code, or the program stops here with a
  complete outcome.
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

## Horizon 5: the phased native-core program

[ADR-0015](adr/0015-adopt-a-phased-native-core-program-with-rust.md) replaces
the open question "is a native subsystem warranted" with a sequence whose
phases enter under the two gates of ADR-0014. No canonical native store,
resident service, or wire protocol is approved before its phase and gate.

| Phase | Gate | Scope | Exit criterion | Reversibility |
| --- | --- | --- | --- | --- |
| 0a Git-native wins | none | Horizon 1.5 | Horizon 1.5 exit criteria (met on Windows 2026-08-29 by ADR-0016 and the ADR-0013 rerun; POSIX run pending) | Flag only; complete outcome on its own. |
| 0b Contract freeze and engine seam | none | Horizon 2 item 1 | Horizon 2 item 1 exit criteria | Pure refactor. |
| 1 Native read engine in Rust | Gate A | Repository context, batched object reads, peeling, history walks, merge-base, ancestry, refs, notes reads, and worktree-scoped status through `vlab-core` behind the seam; per-operation backend matrix in its ADR; bounded jj-lib spike | Suite green in native mode on Linux and Windows with identical JSON; zero Git processes for history, registry, note-catalog, resolution-catalog, and per-workspace status in the scale benchmark; the Gate A named budget met; `git fsck` clean; no lingering processes | Engine selector or uninstall the binding; kill switch and two-release sunset. |
| 2 Native planning and status | Gate A | Merge-plan and rebase-plan construction, receipt reachability, Change-ID extraction, the advisory `git-patch-id-heuristic` proof (a stable patch-id proof, if wanted, gets its own ADR), spec blob-identity checks; FR-ID-06 audit; FR-PLAN-08 proof bundle and verifier | Plan fingerprints byte-identical across engines on the suite plus at least 1,000 generated histories; status semantics preserved at zero processes | Per-operation fallback. |
| 3 Derived catalog | Gate A, plus the incremental-catalog row below (an already-batched path over a representative budget, per ADR-0013) | Deletable fact segments with per-record digests, rebuildable indexes, `builtFrom` stamps, reindex command, approval facts, advisory leases in a mutable side file; caches outside synced folders; notes and refs remain canonical | 5,000-fact benchmark under budget with zero processes on both hosts; deleting the catalog yields identical output; torn-tail and stale-catalog recovery pass; writer-lock waits under 10 ms at 16 concurrent agents | Delete the directory. |
| 4 In-memory forecasts and native mutation | Gate A | Ref transactions and object writes for checkpoints and retained resolutions; virtual three-way merge applying exact-resolution memory and Markdown section merge, with `git merge-tree` as co-oracle | Predicted-tree equality on the suite plus at least 1,000 generated three-way cases; divergence always surfaces as a blocker; FR-REC-06 apply-time check retained | Flag; droppable after 0a evidence. |
| 5 Canonical fact log, transport, draft stacks | Gate B | Fact log canonical with notes, refs, and registry regenerated at finalization; notes import; envelope v2 as a strict superset of v1; Git-carried fact transport; private draft stacks via hidden refs (FR-WS-08); optional thin Rust CLI with byte-identical JSON | All nine Gate B conditions with an evidence table; v1 envelopes import and re-export byte-identically; the ADR partially superseding ADR-0001 accepted | Project, then delete the log. |
| 6 Gateway; service only if the row below fires | Gate B | Horizon 4 in its order | No local planning, forecasting, or landing depends on the gateway | Optional. |

The decision rows for catalogs and services remain in force inside that
sequence:

| Evidence | Permitted next step |
| --- | --- |
| A path launches per-entity Git processes | Batch within the invocation. |
| An already-batched path exceeds a representative budget | Propose an incremental catalog with lifecycle, migration, and equality tests. |
| Cross-command cost remains material on representative Windows and POSIX repositories after justified catalogs | Propose a resident-service ADR covering ownership, locking, security, crash recovery, upgrade, shutdown, and fallback. |
| All nine Gate B conditions of ADR-0014 have an evidence table naming schemas, hosts, and runs | Begin Horizon 5 phase 5 (canonical fact log, transport, draft stacks) behind the existing observable contracts, with Git as oracle and escape hatch. |

Evidence must also show user value: receipts prevent real duplicate work,
forecasts reproduce applied trees, workspace/checkpoint flows improve parallel
work, resolution reuse avoids repeated effort safely, and semantic identity
helps real document corpora. Performance alone is insufficient. That evidence
comes from dogfooding: the maintainer's own coding agents use `vlab` on this
repository and other real repositories on a Windows or OneDrive host and a
POSIX host, with telemetry retained per `docs/README.md`.

Efficiency claims follow ADR-0014's definition: elapsed time per operation and
bytes stored and transferred, per host, against plain Git's best mode and any
named alternative, with identical semantic results.

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
| FR-WS-08 | Deferred | Horizon 5 phase 5 under Gate B |
| FR-WS-09 | Batched status implemented; Linux and Windows synthetic evidence recorded | Real-repository evidence, then Horizon 5 phase 1 zero-process status |
| FR-SPEC-13 | Planned | Horizon 3 adapter conformance and expansion |
| FR-PERF-09 | Evidence gate | Horizon 5 phases 1-3 and the resident-service row |
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
  compatibility story, including how an append-only fact log is pruned.
- Decide the phase 1 backend matrix per operation before native code, and
  whether to borrow from or depend on jj-lib, after the bounded spike.
- Decide before Gate B whether an operation log and a second carrier of
  `ch_*` in commit headers (FR-ID-07) are needed at all.
- Choose the derived-catalog storage by a rebuild-from-segments test; derived
  caches never live in synced folders.
- Define retention-ref scaling, mixed-version client behavior if notes become
  a projection, and where advisory leases live, before phase 5.

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

Until the relevant gates are met, the roadmap explicitly excludes a daemon, a
canonical database (derived, deletable caches are permitted under Gate A per
ADR-0014),
automatic remote synchronization, cryptographic trust claims, live dirty-byte
forecasting, automatic AI conflict resolution, and a production VCS claim.
