# vcs-lab design notes

This file preserves the chronological rationale of the experiments. The active
product contract is [PRD.md](PRD.md), the current system map is
[ARCHITECTURE.md](ARCHITECTURE.md), and normative decisions are indexed in
[docs/adr](docs/adr/README.md). If this narrative conflicts with a later
accepted ADR, the ADR governs.

## Purpose

The prototype tests whether three additional identities are enough to repair common Git workflow problems without breaking Git compatibility:

1. `Change-Id` — stable logical intent across rewritten commits.
2. application record — a target-specific realization of a change.
3. landing receipt — proof that a target incorporated exact source revisions.

Git commit IDs and tree IDs remain the exact immutable state identities.

## Compact versus hard-squash landing

`compact` creates a conventional two-parent Git merge commit. It is compact only in the display graph: first-parent history contains one landing unit. The second parent provides stock Git with correct causal reachability.

`hard-squash` creates a conventional one-parent Git squash commit and attaches a receipt containing the source head, exact absorbed commits, stable Change IDs, before/after revisions, base, and resulting tree. Native planning can use that causal edge; stock Git cannot.

## Reconciliation algorithm in the lab

For every source commit outside the physical Git merge base:

1. exact commit ancestry proves coverage;
2. a reachable landing receipt containing the commit proves coverage;
3. the same stable Change ID in target history proves logical coverage in this single-user lab;
4. a receipt containing the Change ID proves coverage;
5. Git patch equivalence creates an advisory candidate;
6. otherwise the change is new.

Only proven-new changes are applied. Heuristic candidates force a user decision. A production protocol would trust stable identity only when issued or attested by an authorized actor.

## Resumable reconciliation operation

Version 0.2 introduced an operation journal written before applying the first
change. The journal pins the source head, target-before commit, complete merge
plan, ordered application queue, completed applications, and current conflict.
It is stored in the current worktree's private Git directory rather than the
common repository directory.

Clean applications remain provisional in the journal until the entire operation completes. This allows `--abort` to restore the original target without leaving receipts for commits that are no longer reachable. On completion, application records and a reconciliation receipt are published to Git notes.

A conflict resolution has two identities:

- `contextual-application` retains the source Change ID while recording a different result tree;
- `contextual-fork` creates a derived Change ID and deliberately does not mark the original source intent as covered.

This makes causal coverage and exact tree equality independent. A target can cover every source intent while realizing it differently, or it can derive a new intent while leaving the original source change unapplied.

## Reusable conflict resolutions

Version 0.3 adds a deliberately conservative resolution-memory layer. When a
cherry-pick conflicts, the index contains up to three entries for each path:
merge base, target (`ours`), and source (`theirs`). The lab hashes the ordered
triplet of each entry's file mode and blob ID using
`ordered-three-way-blobs/v1`. The file path is excluded, so an exact conflict
can be recognized after a rename or in a separate worktree.

This signature proves byte-for-byte equality of the three conflict inputs; it
does not claim semantic equivalence. A matching resolution is therefore a safe
candidate to present, but v0.3 never mutates the worktree automatically. The
user must run `vlab resolve apply`, may edit the result before continuing, or
may explicitly reject it. If multiple result blobs have been recorded for the
same signature, selection requires a resolution ID.

The completed application records one of four decisions:

- `created` — this exact conflict had no prior candidate;
- `accepted` — a prior result was staged unchanged;
- `modified` — an applied suggestion was changed before continuation;
- `rejected` — prior candidates were declined and another result was used.

Resolution records are Git notes attached to small hidden commits under
`refs/vcs-lab/resolutions/<signature>/<result-blob>`. Each commit retains the
result blob in its tree, making it safe from normal Git garbage collection.
The catalog is common to linked worktrees while each pending choice remains in
that worktree's reconciliation journal.

This is closer to exact `rerere` with explicit provenance than to an AI merge
system. Later experiments can add semantic or learned candidates as a lower
confidence tier without weakening the exact tier.

## Forecasted reconciliation

Version 0.4 moves exact resolution reuse from a reactive workflow into a
reviewable preflight. A forecast builds the normal causal merge plan, creates a
detached temporary worktree at the target head, and cherry-picks only changes
classified as new. Clean changes advance the simulated tree. A conflict with
exactly one known result per path is resolved only inside the simulation. A
missing or ambiguous result blocks the forecast because later changes cannot be
predicted safely without inventing a choice.

Patch-equivalence candidates remain outside the exact tier. Unless the forecast
is explicitly generated with `--accept-candidates`, their presence changes the
forecast to `review-required` and suppresses the claimed final tree.

Forecasting does not publish application receipts or new resolution records.
The temporary worktree is removed even when Git stops in a conflict. The
caller's HEAD, tree, and porcelain status are captured before and after; any
change is treated as an invariant violation. The resulting forecast is stored
under the caller's worktree-private Git directory.

A forecast pins:

- source and target commit IDs;
- source and target tree IDs;
- physical and effective bases;
- reachable causal receipts;
- every planned change's identity, status, and proof;
- exact resolution record IDs, signatures, and result blobs;
- the complete predicted result tree when simulation reaches the end.

`--use-forecast` is the explicit approval event. Reconciliation rebuilds and
fingerprints the plan before changing the target. During a real conflict it
matches the source commit, path, exact three-way signature, resolution ID, and
result blob before staging anything. All choices for that conflict are
validated before the first file is changed. A complete run must reproduce the
predicted tree before receipts are published.

Workspace comparison runs the same algorithm using the target workspace as the
forecast owner and the source workspace's compatibility branch as input. v0.4
compares committed heads only. It surfaces ignored dirty-file counts because
including private drafts requires a future checkpoint/overlay simulation
rather than pretending uncommitted bytes have stable causal identity.

## Performance observation

The prototype still invokes stock Git as subprocesses. `VLAB_TRACE=1` reports
the duration of each Git command without logging user content, and
`vlab doctor --benchmark` samples common repository probes. These measurements
provide a baseline for deciding whether a native daemon, long-lived object
service, or virtualized workspace layer is justified, especially in large
OneDrive-hosted repositories.

Forecast wall time and reconciliation active-application time are recorded
separately. Active time accumulates only during CLI processes that are applying
changes; elapsed wall time remains available to expose human or agent wait time
during a paused reconciliation.

Version 0.5 adds structured command counts and aggregate duration by Git
subcommand to each forecast. Forecast timings separate preflight, causal
planning, temporary-worktree setup, application, cleanup, and caller-invariant
checks. `doctor --benchmark` now supports warmup and sample counts and reports
minimum, median, p95, average, and maximum latency. These measurements expose
the number of compatibility-layer round trips rather than attributing aggregate
latency to a synchronized directory without evidence.

Version 0.6 removes avoidable round trips in the semantic path. A single
`git cat-file --batch` process reads the Markdown and manifest objects for all
three merge stages, and another batch verifies staged results. Applied commit
and tree identities are resolved together. The integration suite caps the
representative deterministic-spec reconciliation path at 10 Git subprocesses,
down from the 19-call Windows v0.5 observation that motivated this work.

Version 0.7 separates a logical Git query from an operating-system process
launch. During a planning, forecast, or reconciliation invocation, immutable
object reads can share one `git cat-file --batch-command` process scoped to the
exact worktree path. The synchronous CLI talks to an asynchronous worker thread
through a bounded shared-memory response channel, preserving the existing
synchronous domain APIs while the worker owns Git's streaming protocol.

The session deliberately caches only expressions rooted at a complete SHA-1 or
SHA-256 object ID. Symbolic names such as `HEAD`, branch refs, and index
expressions are always queried again. Successful mutation commands invalidate
the worktree session, and a session failure falls back to the ordinary Git
path. Separate linked worktrees receive separate sessions because `HEAD`, the
index, and in-progress operation files are worktree-private even when objects
and causal metadata are shared.

Windows enables this path by default based on the measured process-startup
cost. Other platforms can opt in, but do not pay the worker startup cost by
default when Git launches in a few milliseconds. `--git-session` and
`--no-git-session` make both paths directly comparable. Metrics now distinguish
logical queries, process launches, session queries, and immutable cache hits.

Object reuse is paired with structural query reduction: target history and
source-range metadata come from two bounded `git log` streams instead of one
`git show` per commit; note payloads are read as an object batch after one
reachability walk; related revision/tree identities are resolved together; and
cherry-pick state is read from the worktree's private Git directory. In the
release demo, a 12-change forecast drops from 52 Git processes to 25 while
producing the same plan, step trees, and predicted result tree.

## Workspace checkpoint

The checkpoint command creates a temporary Git index, reads `HEAD` into it, adds the current working tree, writes a tree, and uses `git commit-tree` to create an immutable checkpoint. The real index and worktree are untouched. A hidden ref prevents garbage collection.

This is a useful approximation of the proposed native operation log and copy-on-write workspace overlay.

## Hybrid specifications

The lab begins with annotated files, not native structured documents. Exact Markdown bytes remain authoritative. A portable sidecar assigns stable IDs to the preamble, headings, and `REQ-*:` records, demonstrating entity-aware history and review anchoring without requiring new editors.

Version 0.5 upgrades this to deterministic three-way block reconciliation. The
sidecar has no generation timestamp, derives new entity IDs from the shared
artifact ID and semantic key, and is not rewritten when its normalized source
hash is unchanged. Batch indexing resolves the repository context once and
skips unchanged manifests.

Merge units are the preamble and non-overlapping heading-delimited sections.
Requirements remain nested entities for identity and review, but are not a
second overlapping byte-merge layer. For each stable block ID, the merge uses
only base, target, and source presence, content hashes, and ordering:

- one-sided edits, moves, additions, and deletions are deterministic;
- identical concurrent results are deterministic;
- divergent same-block edits are conflicts;
- delete-versus-edit is a conflict;
- incompatible moves or concurrent-add placements are conflicts.

Clean results render canonically and regenerate the sidecar from the same
stable IDs. A semantic signature pins all three document and manifest hashes.
Forecast approval additionally pins the result Markdown and manifest hashes;
real application recomputes them and must still reproduce the complete
forecast tree before causal receipts are published. A paused non-forecast
operation exposes the same plan through `vlab spec status` and requires an
explicit `vlab spec resolve` action. Continuation validates that the staged
sidecar still describes the staged Markdown. An unchanged suggestion is
recorded as `accepted`; a reindexed human adjustment is recorded as `modified`.

The generated-corpus benchmark measures raw and deflate-estimated sizes plus
cold, unchanged, and one-block-change indexing. The readable JSON compatibility
sidecar is intentionally not claimed as a final storage format: measurements
will determine whether a compact index, object-level structural sharing, or a
native content-addressed representation is justified.

Version 0.6 makes the compatibility sidecar sparse. A v3 manifest persists the
artifact ID, source path and normalized hash, entity count, parser/identity
algorithms, an optional Git source-blob ID, and only IDs that cannot be derived
from `artifactId + semanticKey`. Blocks are reconstructed from Markdown when a
query or merge needs them. This preserves the v0.5 API view without repeating
titles, line positions, and hashes in every commit.

Indexing a v1 or v2 manifest produces v3 while retaining every prior logical
ID; exceptional old IDs become overrides. Repository-wide indexing compares
the manifest's source blob with the Git index before opening a document.
Unchanged tracked specs therefore take the zero-content-read path, while new or
changed documents are blob-hashed together. In the default 25-document,
2,025-entity benchmark, sparse metadata is 11,240 bytes versus 655,545 bytes for
the equivalent v2 manifests, a 98.29% reduction.

## Forecasted causal rebase

Version 0.9 treats rebase as replacement of the current source branch, not as
an alias for reconciliation into a target. The same causal proof lattice first
classifies the source range into exact omissions, explicit heuristic review,
and ordered replay. A disposable forecast pins every target-before/result tree
and deterministic conflict decision before the owning worktree is changed.

Application uses an explicit cherry-pick queue because it exposes exact
origin/result mappings and supervised conflict state. A private journal is
written before reset, provisional applications stay private, and abort restores
the exact original source tip. Clean/contextual rewrites preserve logical
identity; changed intent requires `--fork`. Unexpected empty applications are
blocked because Git's implicit skip cannot become a causal proof.

Only a completely verified queue publishes application records and a summary
receipt. Rewriting can make the original commits unreachable from ordinary
branches, so deterministic metadata export retains every commit referenced by
accepted causal records inside the Git bundle. This keeps integrity validation
and offline clone portability aligned with the new history shape.

## Exit criteria for a second prototype

Build a native store only if local trials show that:

- compact landing is accepted as a better default than hard squash;
- causal receipts measurably prevent duplicate/conflicting back-merges;
- stable Change IDs improve rebase, cherry-pick, and review continuity;
- workspace checkpoints and conflict forecasts help parallel agents;
- pinned forecasts reproduce their predicted trees often enough to support
  batch application of exact decisions;
- annotated spec entities remain stable enough under real editing;
- deterministic spec forecasts eliminate independent-block conflicts without
  hiding same-block ambiguity;
- users value causal and semantic queries enough to justify metadata complexity;
- exact resolution reuse removes repeated conflict work without encouraging
  unsafe automatic merges;
- subprocess and filesystem measurements identify a material performance limit
  that a native layer can address.
