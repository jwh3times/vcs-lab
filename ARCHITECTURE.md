# vcs-lab architecture reference

## Document status

| Field | Value |
| --- | --- |
| Architecture baseline | v0.8.x |
| Status | Current implementation reference |
| Last updated | 2026-08-21 |
| Runtime | Node.js 20+ (ES modules), Git 2.38+ |
| External runtime dependencies | None beyond Node.js and Git |

This document explains the system that exists. [PRD.md](PRD.md) defines the
desired product and its requirements. [docs/adr](docs/adr/README.md) records
decisions and their consequences. [DESIGN.md](DESIGN.md) retains the experiment
history and detailed rationale that led here.

When implementation and this document differ, implementation plus tests are
the current fact, but the discrepancy is a documentation defect. When an
implementation change would violate an accepted ADR, the ADR must be
superseded explicitly rather than silently ignored.

## 1. Architectural intent

`vcs-lab` is a compatibility-layer experiment, not an independent object
database. Git is responsible for content-addressed storage, snapshots,
ordinary ancestry, refs, worktrees, staging, merges, cherry-picks, and recovery
mechanics. `vcs-lab` adds:

- stable logical change identity;
- causal landing and application records;
- proof-aware planning;
- isolated forecast and resumable reconciliation orchestration;
- exact conflict-resolution provenance;
- workspace/checkpoint metadata for linked worktrees;
- stable semantic identity and deterministic merge for Markdown specs;
- repository-wide metadata inventory, validation, and quarantine;
- deterministic Git-bundle metadata export and atomic/idempotent import;
- measurement and an optional persistent Git object-query path.

The architecture deliberately separates **exact state** from **causal claims**.
Git OIDs remain the oracle for bytes and parentage. A receipt can explain why
one line of development covers another even when physical ancestry was lost,
but a receipt does not rewrite a commit or tree ID.

## 2. System context

```text
             humans, AI agents, CI, scripts
                         |
                         v
                  +--------------+
                  |  vlab CLI    |
                  | src/cli.js   |
                  +------+-------+
                         |
          +--------------+----------------+
          |              |                |
          v              v                v
  causal workflows   spec workflows   workspace workflows
  plan/forecast/     index/merge/      worktree/checkpoint/
  reconcile/resolve  benchmark         comparison
          |              |                |
          +--------------+----------------+
                         |
                         v
                  +--------------+
                  | Git adapter  |
                  |  src/git.js  |
                  +------+-------+
                         |
              +----------+-----------+
              |                      |
              v                      v
      ordinary Git processes   optional invocation-scoped
                               cat-file session worker
              |                      |
              +----------+-----------+
                         v
             Git objects, refs, notes,
             worktrees, index, files
```

### 2.1 Inside the boundary

- CLI parsing and human/JSON formatting.
- Git command orchestration and metrics.
- Causal plan construction.
- Temporary-worktree simulation.
- Worktree-local operation journals and forecasts.
- Receipt creation and storage through Git notes.
- Resolution signature/catalog management.
- Workspace registry and checkpoint creation.
- Markdown parsing, sparse manifest materialization, and deterministic merge.

### 2.2 Outside the boundary

- Git implementation and filesystem behavior.
- Remote hosting, authentication, authorization, and policy.
- Cryptographic signing and trusted attestation.
- Editor integrations and code review UI.
- Network synchronization beyond normal Git/ref commands.
- Language-model judgment.

## 3. Source layout and component responsibilities

| File | Responsibility | Important dependencies |
| --- | --- | --- |
| `bin/vlab.js` | Minimal executable entry point and error/exit boundary | `src/cli.js` |
| `src/cli.js` | Argument parsing, command dispatch, human and JSON presentation, benchmarks | All domain modules |
| `src/errors.js` | Expected CLI error type with optional detail | None |
| `src/ids.js` | Unique protocol IDs, SHA-256, Git blob hashing, slugs | Node crypto |
| `src/git.js` | Safe synchronous Git adapter, repository context, object reads, sessions, metrics | Git executable, worker |
| `src/git-session-worker.js` | Owns asynchronous `git cat-file --batch-command` stream for a synchronous caller | Worker threads, Git |
| `src/store.js` | Common runtime directory and atomic JSON read/write | `src/git.js` |
| `src/notes.js` | Append/list/read causal records in `refs/notes/vcs-lab` | `src/git.js` |
| `src/schemas.js` | Supported schema registry, structural record validation, object-reference and resolution-signature rules | IDs |
| `src/metadata.js` | Deterministic inventory, scope classification, integrity diagnostics, lineage, and accepted-record filtering | Git, schemas, specs |
| `src/metadata-envelope.js` | Canonical envelope manifest, integrity hash, payload bounds, and parser | Metadata, schemas |
| `src/metadata-transfer.js` | Sanitized bundle export, dry-run inspection, conflict planning, staging, and atomic ref import | Metadata, envelope, Git |
| `src/landings.js` | Compact and hard-squash landing mechanics and receipts | Git adapter, notes |
| `src/merge-plan.js` | Coverage proof lattice, effective base, patch candidates, plan formatting | Git adapter, notes |
| `src/forecasts.js` | Plan fingerprint, temporary-worktree simulation, decision pinning, saved forecasts | Plan, operations helpers, specs, resolutions, Git |
| `src/operations.js` | Commit/cherry-pick and reconciliation start/queue/continue/abort/finalize | Plan, forecast, notes, resolution/spec modules |
| `src/reconcile-state.js` | Worktree-private reconciliation journal and Git in-progress state probes | Repo context, filesystem |
| `src/resolutions.js` | Exact three-way conflict signatures, candidate selection, result retention, outcome audit | Git adapter, notes, reconciliation state |
| `src/workspaces.js` | Workspace registry, linked-worktree creation/listing, temporary-index checkpoints | Git adapter, store |
| `src/specs.js` | Markdown parsing, sparse manifest migration/indexing, deterministic merge, semantic resolution, benchmark | Git adapter, IDs, reconciliation state |
| `src/version.js` | Runtime version constant | None |
| `test/integration.test.js` | Disposable-repository end-to-end contract suite | CLI and Git |
| `scripts/*.mjs` | Reproducible user experiments and performance comparisons | Published CLI behavior |

The code is intentionally dependency-free. Domain modules use synchronous APIs
so a CLI command has a linear, auditable control flow. The Git session worker
contains the asynchronous streaming boundary without converting the domain
layer to promises.

## 4. State and identity model

### 4.1 Identity layers

```text
logical change ch_*             stable intent
        |
        | applied in a target context
        v
application apply_* ----------> result Git commit OID
        |                              |
        | grouped/finalized            | exact bytes
        v                              v
reconciliation reconcile_*      Git tree OID

source commits --absorbed by--> landing land_* --attached to--> landing commit

workspace ws_* --materialized as--> Git linked worktree
spec artifact artifact_* --contains--> deterministic/overridden entity IDs
```

- A **Git commit OID** changes when content, metadata, or parents change.
- A **Git tree OID** identifies exact repository file state independent of
  commit message and parents.
- A **Change ID** is a logical continuity claim embedded in a commit trailer.
- An **application record** links one source logical change to a target-specific
  result commit.
- A **landing record** states that one integration commit absorbed exact source
  revisions and logical IDs.
- A **reconciliation record** summarizes the reviewed plan and all applications
  after the complete operation succeeds.

No layer substitutes for another. For example, equal Change IDs do not imply
equal trees, and equal trees do not imply the same intent or review event.

### 4.2 Change ID generation and propagation

`vlab commit` appends a generated `Change-Id: ch_*` trailer unless an identity
is already deliberately supplied by the workflow. Ordinary commits without a
trailer are assigned an ephemeral planning identity `git:<commit-oid>`; this
does not pretend they will survive rewriting.

`vlab cherry-pick` defaults to the same logical ID. `--fork` creates a new
Change ID and adds origin trailers. During conflict continuation, `--fork`
likewise marks the target result as changed intent rather than a contextual
adaptation of the same intent.

## 5. Persistence topology

The placement rule is: mutable, in-progress choices belong to one worktree;
completed reusable facts belong to the shared repository; portable document
identity belongs in tracked files.

| Data | Scope | Location | Lifecycle |
| --- | --- | --- | --- |
| Git source/history state | Shared repository | Git objects and ordinary refs | Normal Git lifecycle |
| Causal notes | Shared repository | `refs/notes/vcs-lab` | Portable through a validated metadata envelope |
| Resolution result objects | Shared repository | `refs/vcs-lab/resolutions/<signature>/<result-blob>` | Hidden ref prevents GC; envelope transports accepted refs |
| Workspace registry | Shared repository installation | `<common-git-dir>/vcs-lab/workspaces.json` | Local; not automatically remote-portable |
| Checkpoints | Shared repository | `refs/vcs-lab/checkpoints/<workspace-id>` | One ref chain per workspace |
| Pending reconciliation | One linked worktree | `<worktree-git-dir>/vcs-lab/reconciliation.json` | Cleared on complete/abort |
| Saved forecasts | One linked worktree | `<worktree-git-dir>/vcs-lab/forecasts/<id>.json` | Private approval artifact |
| Spec identity manifest | Tracked/repository portable | `.vcs-lab/specs/<source>.json` | Versioned with Markdown |
| Persistent object session | One CLI invocation and worktree | Memory plus worker process | Closed at invocation end |

`src/store.js` writes JSON through a temporary file and same-directory rename.
Worktree-private paths are derived from `git rev-parse --git-dir`; shared paths
are derived from `--git-common-dir`. This distinction is required for linked
worktree correctness.

## 6. Persisted schemas

Schemas are namespaced and versioned in a `schema` field. The following are in
use at the v0.8 baseline:

| Schema | Purpose | Primary owner |
| --- | --- | --- |
| `vcs-lab.note/v1` | Container for records attached to one Git object | `notes.js` |
| `vcs-lab.landing/v1` | Compact or hard-squash causal receipt | `landings.js` |
| `vcs-lab.application/v1` | Direct cherry-pick application record | `operations.js` |
| `vcs-lab.application/v4` | Reconciliation application with conflict/spec decisions | `operations.js` |
| `vcs-lab.reconciliation/v6` | Final operation summary, coverage, trees, timing | `operations.js` |
| `vcs-lab.reconciliation-operation/v4` | Private resumable operation journal | `operations.js` |
| `vcs-lab.merge-plan/v1` | Source/target coverage plan | `merge-plan.js` |
| `vcs-lab.forecast/v2` | Pinned simulation and approvals | `forecasts.js` |
| `vcs-lab.resolution/v1` | Exact resolution result and provenance | `resolutions.js` |
| `vcs-lab.workspaces/v1` | Workspace registry container | `workspaces.js` |
| `vcs-lab.workspace/v1` | Workspace descriptor | `workspaces.js` |
| `vcs-lab.checkpoint/v1` | Checkpoint command result | `workspaces.js` |
| `vcs-lab.spec-manifest/v3` | Sparse Markdown identity manifest | `specs.js` |
| `vcs-lab.spec-merge-plan/v1` | Deterministic three-way semantic plan | `specs.js` |
| `vcs-lab.spec-benchmark/v2` | Generated corpus measurements | `specs.js` |
| `vcs-lab.metadata-status/v1` | Deterministic repository metadata inventory | `metadata.js` |
| `vcs-lab.metadata-validation/v1` | Inventory plus strict/non-strict validity result | `metadata.js` |
| `vcs-lab.metadata-envelope/v1` | Portable manifest for sanitized notes and resolution refs | `metadata-envelope.js` |
| `vcs-lab.metadata-export/v1` | Export result and process/storage metrics | `metadata-transfer.js` |
| `vcs-lab.metadata-import-preview/v1` | Exact dry-run record/ref/object actions | `metadata-transfer.js` |
| `vcs-lab.metadata-import/v1` | Applied/idempotent import result | `metadata-transfer.js` |

Current schemas are executable JavaScript validators and named object shapes,
not yet published as standalone JSON Schema files. Unknown portable record
schemas are quarantined rather than consumed. Schema-version changes still
require migration/compatibility tests.

## 7. Causal planning architecture

`buildMergePlan(sourceRef)` performs these steps inside an optional Git object
session:

1. Resolve exact target and source commits.
2. Compute their physical merge base.
3. Resolve target/source tree IDs and report exact state equality.
4. Read target history and collect commit IDs and Change IDs.
5. read causal records attached to commits reachable from the target and keep
   only records whose registered schema, attachment, and referenced Git objects
   validate.
6. Collect absorbed commit and Change IDs from landing/reconciliation records.
7. Use `git cherry` to identify advisory patch-equivalent candidates.
8. Read source commits outside the physical merge base in chronological order.
9. Choose the furthest receipt-backed source head that is an ancestor of the
   source tip as the effective causal base.
10. Classify each source change by the proof lattice.

### 7.1 Coverage proof lattice

The current precedence is:

1. `commit-ancestry`: exact source commit is directly reachable from target.
2. `signed-shaped-landing-receipt`: name retained for compatibility; a reachable
   landing/reconciliation record lists the exact source commit. The record is
   not cryptographically signed in v0.7.
3. `stable-change-id`: target history contains the same logical ID.
4. `receipt-change-id`: a reachable receipt absorbed the logical ID.
5. `git-patch-id-heuristic`: advisory candidate only.
6. no proof: new work.

The awkward historical proof label `signed-shaped-landing-receipt` means “a
record shaped for future signed proof,” not “verified signature.” It should be
renamed or formally versioned when the proof schema is standardized.

### 7.2 Reachability rule

Only receipts attached to commits reachable from the target participate in
coverage. A receipt elsewhere in the repository cannot suppress work on an
unrelated target. Note contents are read in a batch after the reachability walk.

## 8. Landing flows

### 8.1 Compact landing

```text
target-before ----- landing-commit
                      /
source-head ---------
```

1. Require a clean target worktree.
2. Resolve target, source, base, source range, and Change IDs.
3. Run `git merge --no-ff --no-commit <source-head>`.
4. Commit with landing trailers.
5. Attach a landing receipt.

This is the preferred shape because stock Git retains the causal parent.

### 8.2 Hard-squash landing

```text
target-before ----- squash-commit       source-head
                         :                  |
                         : receipt edge     |
                         +------------------+
```

The flow uses `git merge --squash`, commits one parent, and attaches the exact
absorbed range as a receipt. If the merge conflicts before commit, the command
publishes no receipt. Stock Git cannot infer the sideband edge; `vlab` can.

## 9. Forecast architecture

A forecast is a simulation artifact, not a promise based on branch names.

```text
caller worktree (captured invariants)
        |
        +--> build exact causal plan
        |
        +--> create detached temporary worktree at target OID
                    |
                    +--> apply each reviewed-new change
                    +--> inspect exact conflicts
                    +--> apply one exact known result if unambiguous
                    +--> compute deterministic spec merge if clean
                    +--> record step/result trees or blocker
        |
        +--> remove temporary worktree
        +--> verify caller HEAD/tree/status unchanged
        +--> save pinned forecast in caller's private Git dir
```

### 9.1 Forecast contents

- source/target commit and tree IDs;
- physical/effective bases and reachable receipts;
- full classified plan and its SHA-256 fingerprint;
- candidate-equivalence acceptance setting;
- each simulated step and result tree;
- exact conflict signatures and chosen resolution record/result blobs;
- deterministic spec signatures and result hashes;
- partial tree for a blocker;
- predicted final tree for a complete simulation;
- phase timings and Git logical/process metrics.

### 9.2 Isolation mechanics

The implementation creates a temporary detached Git worktree, performs the
simulation there, aborts any in-progress cherry-pick, and removes/prunes the
temporary worktree in cleanup. The caller's head, tree, and porcelain status
are captured before and after. A difference is an invariant violation.

Forecasts use committed heads only. Dirty-file counts may be reported, but
uncommitted bytes are not silently treated as stable causal inputs.

## 10. Reconciliation state machine

```text
                   conflict
new -> running ----------------> paused
         |                         |
         | queue complete          | continue
         v                         v
     finalizing <-------------- running
         |
         +--> completed (journal removed, records published)

paused/running/forecast-mismatch --abort--> starting commit restored
```

### 10.1 Start

1. Require a clean worktree and no existing operation.
2. Build and optionally compare the plan with a named saved forecast.
3. Reject unaccepted candidates or stale forecast inputs before mutation.
4. Create a private journal containing the complete queue, starting commit,
   exact plan, approvals, timing accumulator, and current index.
5. Cherry-pick queue entries one at a time.

### 10.2 Clean application

After Git creates the applied commit, the tool resolves source and result trees,
creates an application record in the private journal, and advances. Records are
not published to notes yet because a later queue item may fail or be aborted.

### 10.3 Conflict pause

The tool records:

- current source change and target-before commit;
- Git-reported conflicted paths;
- ordered three-way conflict descriptors;
- exact resolution candidates;
- deterministic spec plans when indexed Markdown is involved;
- forecast approvals, if any.

It leaves Git's cherry-pick state intact and exits with recovery instructions.

### 10.4 Continue

The user or forecast stages a resolution. Continue verifies the operation and
staged semantic manifests, invokes `git cherry-pick --continue`, classifies the
relation as contextual application or contextual fork, records exact outcomes,
and resumes the remaining queue.

### 10.5 Finalize

Before publication, finalization:

1. resolves result commit/tree;
2. compares a pinned predicted tree, if present;
3. excludes explicit forks from absorbed-source coverage;
4. constructs application and reconciliation records;
5. publishes retained resolution results;
6. appends application notes to applied commits;
7. appends the final reconciliation note;
8. removes the private journal.

If the predicted tree differs, the state becomes `forecast-mismatch`; receipts
are not published and abort remains available.

### 10.6 Abort

Abort delegates in-progress cherry-pick cleanup to Git as applicable, restores
the exact `targetBefore` commit recorded at operation start, and clears private
state. Since application records were not published early, an aborted queue
leaves no causal claim for partial work.

## 11. Exact resolution architecture

For each unmerged path, Git index stages provide:

- stage 1: merge base blob;
- stage 2: target/ours blob;
- stage 3: source/theirs blob.

The ordered blob identities form `ordered-three-way-blobs/v1`. The file path is
not part of the signature, enabling exact reuse after a rename. A candidate
record points to a result blob retained in a small commit under:

```text
refs/vcs-lab/resolutions/<signature>/<result-blob>
```

Selection rules:

- zero candidates: resolve manually; successful continuation can create one;
- one candidate: show it, but require `resolve apply` or forecast approval;
- multiple result blobs: require an explicit resolution record ID;
- user edits an applied candidate: record `modified`;
- user rejects candidates and resolves differently: record `rejected`.

This is exact resolution memory with explicit provenance, not a learned merge
engine. Future learned candidates must be a visibly lower confidence tier.

## 12. Workspace and checkpoint architecture

`vlab workspace create` records a logical descriptor and creates a normal
linked worktree on `vlab/ws/<slug>`. The compatibility branch is necessary for
Git's current worktree retention semantics, not the desired final workspace
model.

The registry resides in the common Git directory so every linked worktree can
discover it. A descriptor includes logical ID, name, path, branch, pinned base,
target label, optional owner/focus, creation time, and lifecycle.

### 12.1 Non-disruptive checkpoint

1. Create a disposable directory and temporary index.
2. Read `HEAD` into that index.
3. Add the current working tree through the temporary index.
4. Write a tree.
5. Create a commit whose parent is the previous workspace checkpoint or current
   `HEAD`.
6. update `refs/vcs-lab/checkpoints/<workspace-id>`.
7. Remove the temporary index directory.

The real index, `HEAD`, and working files never change. Ignored files remain
excluded by normal Git rules.

## 13. Specification architecture

### 13.1 Canonical and derived data

Markdown is canonical. A v3 manifest persists only:

- schema;
- artifact ID;
- normalized source path and source hash;
- optional tracked Git source blob OID;
- entity count;
- representation, parser, and ID algorithm identifiers;
- exceptional ID overrides needed to preserve legacy identities.

Titles, line positions, content hashes, semantic keys, and ordinary IDs are
reconstructed from the Markdown on demand.

### 13.2 Parser and entity identity

The parser `stable-markdown-blocks/v1` identifies:

- an optional preamble;
- heading-delimited sections;
- explicit `REQ-*:` records as nested addressable entities.

Ordinary IDs are derived with
`artifact-semantic-key-sha256/v1`. A migration from expanded v1/v2 manifests
compares old identities and writes only non-derived values into `idOverrides`.

### 13.3 Incremental indexing

For repository-wide indexing:

1. inventory tracked and non-ignored Markdown;
2. resolve repository context once;
3. compare the manifest's `sourceBlob` with the Git index blob;
4. return a zero-content-read cache hit when equal;
5. batch-hash/read only new or changed sources;
6. avoid rewriting an unchanged manifest.

### 13.4 Deterministic three-way merge

Merge units are non-overlapping preamble and heading sections. Requirements are
nested identity/review entities, not a competing byte-merge layer.

For each stable primary block, the algorithm compares base, target, and source
presence, content, and placement:

- one-sided edit/add/delete/move: select changed side;
- identical concurrent result: select it;
- target edit plus source move (or reverse): combine if ordering is compatible;
- divergent same-block edits: block;
- delete versus edit: block;
- incompatible moves or add placement: block.

A clean result is rendered with LF line endings, one blank line between blocks,
and one final newline. The sparse sidecar is regenerated with the same IDs. The
plan pins all input stage fingerprints and output Markdown/manifest hashes.

### 13.5 Integration with reconciliation

Git commonly reports a conflict in the tracked sidecar even when Markdown
blocks are independent. During forecast or a paused operation, `specs.js` reads
the base/target/source Markdown and manifests in batches, builds a semantic
plan, and exposes it as a deterministic decision. A forecast can pin and later
authorize it. Without a forecast, `vlab spec resolve` stages the explicit
suggestion. Continue validates that the sidecar still describes staged
Markdown and records `accepted` or `modified`.

## 14. Git adapter and persistent object session

### 14.1 Ordinary adapter

`runGit(args, options)` uses argument arrays, controlled environment merging,
bounded buffers, explicit binary/text handling, and optional expected failure.
Successful mutation commands invalidate any active object session. Active
metric collectors record logical query count, process launches, duration,
failure, and command group. Trace mode emits metadata only.

Repository context is resolved as a tuple:

```text
{ root, gitDir, commonDir, objectFormat }
```

This supports SHA-1/SHA-256 and prevents the common error of treating the shared
Git directory as the current linked worktree's private Git directory.

### 14.2 Invocation-scoped session

On Windows by default, or with `--git-session`/`VLAB_GIT_SESSION=1`, a domain
operation may open one `GitObjectSession` keyed by resolved worktree path. A
worker thread owns:

```text
git cat-file --batch-command
```

The synchronous main thread submits `info` or `contents` queries through a
bounded shared-memory channel. The worker serializes requests and parses the
streaming response.

### 14.3 Cache and safety rules

- Only expressions rooted at a complete SHA-1 or SHA-256 OID are immutable
  cache candidates.
- `HEAD`, branch/tag names, revision walks rooted at symbolic refs, and index
  expressions are not cached.
- A successful mutation invalidates the worktree session.
- A failed/closed/timed-out session marks itself unusable and callers fall back
  to ordinary Git.
- Each linked worktree receives a distinct session.
- The session ends with the enclosing invocation; there is no background daemon
  or cross-command lock.

The ordinary path remains both fallback and semantic oracle. Equality matters
more than raw wall time.

## 15. Consistency model and invariants

### 15.1 Strong local invariants

- Git OIDs exactly identify state.
- A named forecast applies only to its exact target/source/plan.
- A forecasted complete reconciliation must reproduce its predicted tree.
- No partial application receipts are shared before whole-operation success.
- A worktree has at most one pending reconciliation journal.
- Resolution reuse requires the exact ordered blob signature.
- A semantic sidecar must match its Markdown at continue time.
- Candidate equivalence is never silently accepted.

### 15.2 Explicit cross-clone consistency

Causal notes and resolution refs still do not follow normal branch fetches
automatically. `metadata export` creates a deterministic manifest and sanitized
Git bundle; `metadata import --dry-run` verifies it in a disposable repository,
then `--apply` stages and atomically publishes non-conflicting refs. Tracked
spec manifests move with ordinary project content. Workspace registries,
checkpoints, reconciliation journals, and forecasts remain deliberately local.

Envelope v1 lineage uses Git object format plus sorted root commits reachable
from branches, tags, and remote-tracking refs. Equal roots identify the same
lineage; any shared root identifies an ordinary fork. Unrelated and
history-filtered histories fail closed.

### 15.3 Trust limitation

Current receipts are integrity-linked to Git object IDs but locally writable by
any actor with repository access. They are evidence consumed under local trust,
not signatures or authorization. The historical phrase
`signed-shaped-landing-receipt` does not change that boundary.

## 16. Failure handling

| Failure | Behavior |
| --- | --- |
| Dirty worktree before a mutating operation | Stop and print porcelain paths. |
| Landing merge conflict | Leave Git conflict for manual recovery; publish no landing receipt. |
| Reconciliation conflict | Persist journal and exact descriptors; leave cherry-pick paused. |
| CLI process exits during pause | Next process reads worktree-private journal and continues/status/aborts. |
| Forecast input is stale | Stop before starting reconciliation. |
| Forecast result tree differs | Do not publish receipts; preserve abort path. |
| Exact resolution is ambiguous | Require explicit record ID. |
| Spec merge is ambiguous or metadata stale | Leave blocked; require manual edit/reindex. |
| Persistent object worker fails | Mark session failed and use ordinary Git. |
| Unknown/malformed/dangling causal record | Diagnose and quarantine it from coverage, resolution lookup, and export. |
| Envelope payload or inventory mismatch | Reject before destination mutation. |
| Import ID/ref conflict | Report exact conflict during dry-run; never overwrite silently. |
| Import publication race/failure | Checked atomic ref transaction fails; existing destination facts remain intact. |
| Temporary forecast worktree cleanup encounters in-progress Git state | Abort it best-effort, remove worktree, prune metadata. |
| JSON state write is interrupted | Temporary file avoids replacing last complete record. |

Crash consistency between a successful Git mutation and a journal write has
not yet received full fault-injection coverage. Production hardening must model
and test process termination at every boundary.

## 17. Security boundaries

### 17.1 Inputs treated as untrusted

- CLI arguments and ref names;
- paths discovered from Git and the working tree;
- note/manifest JSON;
- commit messages and trailers;
- imported/fetched Git objects and refs;
- saved forecast and operation files if edited outside the tool.

### 17.2 Existing controls

- Git is invoked without shell interpolation.
- Object expressions reject newlines and protocol-breaking forms.
- Output buffers and session shared-memory buffers are bounded.
- IDs used in paths are validated/slugged.
- Trace output excludes object contents and messages.
- Exact inputs are re-resolved before approved decisions are applied.

### 17.3 Missing controls

- standalone JSON Schema documents and complete resource bounds for every
  local/private record family;
- cryptographic signatures and actor identity;
- authorization/policy evaluation;
- metadata quarantine and conflict resolution across remotes;
- malicious repository fuzzing and path-edge-case coverage;
- a security model for any future resident service.

## 18. Observability and benchmarks

`beginGitMetrics`/`endGitMetrics` can nest around a domain phase. Reports include:

- logical command count;
- actual process launches;
- session queries and immutable cache hits;
- failures;
- aggregate/maximum duration by Git subcommand.

Forecasts separate preflight, planning, simulation, invariant, and temporary
worktree phases. Reconciliation accumulates active time across start/continue
processes and separately records elapsed wall time.

`vlab doctor --benchmark` measures ordinary repository probes and the object
session. `vlab spec benchmark` measures cold, unchanged, and one-change corpus
paths plus metadata size. `npm run demo:git-session` compares optimized and
ordinary forecasts for semantic equality and process count.

## 19. Testing architecture

The integration suite creates disposable Git repositories and invokes the real
CLI and Git executable. This tests filesystem state, refs, notes, worktrees,
process boundaries, line endings, and recovery behavior that unit mocks would
hide.

The v0.8 baseline contains 31 scenarios covering:

- initialization and versioning;
- compact/hard-squash landing and causal suppression;
- cherry-pick continuity and explicit fork;
- checkpoints and linked-worktree isolation;
- spec identity, migration, indexing, deterministic/blocked merges;
- forecast non-mutation, staleness, result mismatch, and batch approval;
- resumable conflicts, continue, abort, and contextual fork;
- exact resolution reuse, ambiguity, modification, and rejection;
- query batching, metrics, session equality, fallback, and worktree scoping.
- metadata scope inventory, stable diagnostics, invalid-record quarantine,
  deterministic envelopes, tamper/lineage/conflict rejection, and idempotent
  two-clone causal/resolution/spec parity.

The same suite is run with the session forced on. Demos complement tests by
providing user-inspectable repositories and commands.

## 20. Extension rules

New capabilities should enter through versioned contracts:

- A new proof type must define evidence, reachability, precedence, and whether
  it can suppress work automatically.
- A new semantic format must define canonical bytes, entity boundaries, stable
  identity, deterministic rules, blockers, and migrations.
- A new automatic resolution tier must expose confidence/provenance and cannot
  weaken the exact tier.
- A new persistence location must state worktree/shared/portable scope,
  lifecycle, GC behavior, migration, and sync.
- A performance optimization must be equality-tested against ordinary Git and
  preserve failure recovery.
- A resident service must define ownership, locking, crash recovery, security,
  upgrade, shutdown, and fallback before implementation.
- A remote protocol must distinguish object integrity, causal evidence,
  signature trust, and policy authorization.

## 21. Known limitations and architectural debt

- Envelopes are explicit offline artifacts; automatic remote capability
  negotiation and synchronization are not implemented.
- JSON schemas are executable validators but not yet published as standalone
  JSON Schema documents.
- Some historical schema/proof labels no longer describe their trust level
  cleanly.
- Workspace registry stores local absolute paths and has limited lifecycle
  repair.
- Forecasts cannot yet consume checkpoint/draft overlays.
- Rebase has no first-class causal plan/apply workflow.
- Notes lookup still scales with the notes namespace and reachable history;
  large-repository indexes are not implemented.
- Crash boundaries have integration coverage for process-separated pauses but
  not systematic kill/fault injection at every mutation/journal edge.
- Persistent session buffers are intentionally bounded and invocation-scoped;
  very large objects or workloads may fall back or require redesign.
- Markdown merge units are heading sections; nested requirement text does not
  merge independently.
- There is no cryptographic trust, server policy, or negotiated protocol.

## 22. Candidate next architectural increment

Metadata portability is now implemented without a server. The next increment
should choose one bounded product gap—first-class rebase planning or workspace
lifecycle/draft-overlay forecasting—through a new proposed ADR. In parallel,
larger note/resolution/worktree fixtures should measure when inventory scans or
explicit envelopes need an index or remote capability negotiation. A server or
native database still requires the PRD's measured exit criteria.
