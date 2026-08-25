# vcs-lab

`vcs-lab` is a local, dependency-free prototype for experimenting with the source-control ideas discussed in this project:

- Git remains a real compatibility and storage layer.
- logical changes keep a stable `Change-Id` across rebase and cherry-pick;
- compact merges retain a real causal parent while displaying as one first-parent landing;
- hard squashes record exactly what they absorbed in a causal landing receipt;
- a merge planner subtracts proven prior work instead of relying only on Git topology;
- causal rebase plans and forecasts preview exact omissions, heuristic reviews,
  replay steps, conflicts, and the predicted tree before a supervised rewrite;
- supervised causal rebase preserves stable intent, pauses and recovers through
  a worktree-private journal, and publishes exact mappings only after success;
- Windows planning and forecasting reuse a worktree-scoped Git object process instead of spawning once per read;
- reconciliation can be forecast in an isolated worktree and pinned before application;
- indexed Markdown can be merged deterministically by stable block identity;
- conflicted reconciliation can pause, survive process exit, continue, or abort safely;
- exact conflict resolutions can be suggested across branches and worktrees with explicit provenance;
- workspaces use real Git worktrees but add path-independent logical metadata and non-disruptive checkpoints;
- Markdown remains canonical while a sidecar gives sections and requirements stable entity IDs.
- repository metadata can be inventoried, validated, quarantined, and moved
  between related clones in an integrity-checked Git-bundle envelope.
- repository and shared-metadata scan costs can be measured in a disposable
  scale fixture before choosing batching, indexes, or a resident service.

This is a laboratory, not a production VCS. Its purpose is to make the semantics observable and falsifiable before designing a native object store or network protocol.

## Documentation map

- [docs](docs/README.md) indexes the maintained product, architecture, testing,
  and decision records and explains where transient evidence belongs.
- [Product requirements](docs/product.md) defines product intent, requirements,
  success metrics, release gates, and roadmap.
- [Roadmap](docs/roadmap.md) separates delivered, implemented-but-unreleased,
  next, candidate, and evidence-gated work.
- [Architecture](docs/architecture.md) maps the current implementation, schemas,
  runtime flows, safety boundaries, and known debt.
- [Architecture decisions](docs/adr/README.md) records constraints that should
  not be casually reversed; [CHANGELOG.md](CHANGELOG.md) records delivered
  behavior by version.

## Requirements

- Node.js 20 or newer
- Git 2.38 or newer

It has no npm dependencies and does not need a build step.

## Install locally

From this directory:

```bash
npm link
vlab --help
```

Alternatively, run it without installing:

```bash
node /path/to/vcs-lab/bin/vlab.js --help
```

On Windows, use PowerShell, Git Bash, or a terminal where `git` and `node` are on `PATH`.

This project now has its own Git history and should live in a normal development repository. The portable repository bundle retains the release commits and tags:

```bash
git clone /path/to/causal-vcs-lab-0.8.0.bundle vcs-lab
cd vcs-lab
git remote remove origin
npm link
npm test
```

If you instead use the source ZIP, initialize its extracted directory with:

```bash
git init -b main
git add .
git commit -m "Bootstrap causal-vcs-lab 0.8.0"
npm link
npm test
```

## Five-minute experiment

Create a disposable repository:

```bash
mkdir vlab-playground
cd vlab-playground
git init -b main
git config user.name "Local Tester"
git config user.email "tester@example.test"
vlab init
```

Create a base and a feature with stable change identities:

```bash
echo base > app.txt
git add app.txt
vlab commit -m "base"

vlab branch feature
echo feature > feature.txt
git add feature.txt
vlab commit -m "feature part one"
echo more >> feature.txt
git add feature.txt
vlab commit -m "feature part two"
```

### Recommended compact landing

```bash
git switch main
vlab merge feature --compact
git log --first-parent --oneline
git show -s --format=%P HEAD
```

The first-parent log contains one landing unit, while the commit has a real second parent. Stock Git can safely merge the branches later.

### Strict hard squash and causal reconciliation

Repeat the experiment with another feature:

```bash
git switch -c hard-feature main
echo first > hard.txt
git add hard.txt
vlab commit -m "hard feature one"
echo second >> hard.txt
git add hard.txt
vlab commit -m "hard feature two"

git switch main
vlab merge hard-feature --hard-squash

git switch hard-feature
echo continuation > continuation.txt
git add continuation.txt
vlab commit -m "hard feature continuation"

git switch main
vlab merge-plan hard-feature
vlab reconcile hard-feature
```

The planner should report the first two changes as `covered` by the landing receipt and only the continuation as `new`. `reconcile` cherry-picks only the proven-new change and records another causal receipt.

Inspect the ordinary branch graph together with the causal relationships:

```bash
vlab graph
vlab receipts
```

`vlab graph` deliberately hides internal Git notes and checkpoint refs. Raw `git log --all` includes the history of `refs/notes/vcs-lab`, which can appear as unrelated commits titled `Notes added by 'git notes add'`. For a clean stock-Git view, use:

```bash
git log --graph --oneline --decorate --branches --tags --remotes
```

`vlab receipts` is human-readable by default; use `vlab receipts --json` for the complete machine-readable records.

The planner uses three statuses:

- `=` proven covered by ancestry, stable identity, or a receipt;
- `?` likely patch-equivalent, requiring explicit confirmation;
- `+` new work.

Similarity is deliberately advisory. Run `vlab reconcile <branch> --accept-candidates` only after reviewing candidate equivalence.

## Planning and forecasting a causal rebase

Preview how a linear source branch would be rewritten onto another commit or
branch without switching or modifying the caller:

```bash
git switch hard-feature
vlab rebase-plan main
vlab rebase-plan main hard-feature --json
vlab rebase-forecast main
vlab rebase-forecast main hard-feature --json
git status --short
```

The plan uses the same exact coverage proofs as reconciliation. Covered changes
are marked `omit`, heuristic patch candidates remain `review`, and new changes
enter the ordered `replay` queue. It also emits a deterministic fingerprint and
marks source ranges containing merge commits unsupported by linear v1.

`rebase-forecast` saves a worktree-private
`vcs-lab.rebase-forecast/v1` artifact. It simulates only the ordered replay
queue in a disposable detached worktree, records every target-before and
result tree, pins the plan fingerprint and candidate policy, and reports a
complete predicted tree or a fail-closed conflict/unsupported reason. Dirty
caller files are counted but excluded from the committed-head simulation;
caller branch, `HEAD`, index, status, file bytes, and worktree list remain
unchanged.

Heuristic candidates still block a final prediction until explicitly accepted:

```bash
vlab rebase-forecast main hard-feature --accept-candidates
```

Apply the current named branch after reviewing the plan or a complete forecast:

```bash
vlab rebase main --use-forecast rebase_forecast_...
```

Execution rebuilds the plan and rejects a stale forecast before moving the
branch. It resets the current branch to the exact `onto` commit and replays only
the selected changes in source order. Clean and contextual same-intent rewrites
preserve `Change-Id`; an unexpectedly empty replay blocks instead of silently
disappearing.

If a conflict pauses the queue, ordinary editing and `git add` remain usable:

```bash
vlab rebase --status
# resolve and stage files
vlab rebase --continue
```

Use `vlab rebase --continue --fork` when the resolution deliberately changes
intent. That creates a new Change ID with `Derived-From` provenance. Use
`vlab rebase --abort` to restore the exact original branch tip, including after
earlier queue entries replayed cleanly. Application and summary receipts remain
private until the complete queue and any predicted final tree are verified.

Linear v1 operates only on the current named branch. Merge-preserving,
interactive edit/reword/squash, arbitrary range, and dirty-overlay rebases
remain ordinary Git workflows.

## Forecasting reconciliation

The lab can simulate the complete proven-new queue before touching the
current worktree:

```bash
vlab forecast feature
git status --short
```

The command creates a disposable detached Git worktree, applies clean changes,
uses any single exact-resolution candidates in the simulation, and removes the
temporary worktree. It reports each predicted causal decision, the partial or
complete result tree, blocking conflicts, and forecast duration. The caller's
HEAD, index, and working files are checked before and after and must be
unchanged.

Each forecast is pinned to exact source and target heads and a fingerprint of
the causal merge plan. After reviewing it, explicitly authorize its exact
resolution IDs as a batch:

```bash
vlab reconcile feature --use-forecast forecast_...
```

Heuristic patch-equivalence remains a separate trust decision. A forecast with
unaccepted `?` candidates reports `review-required` and does not claim a final
tree; review them and regenerate with `--accept-candidates` if appropriate.

Application rechecks every conflict signature and resolution ID. If branch or
causal metadata changed, the command stops before starting. A complete forecast
also pins the predicted result tree; a mismatch prevents receipt publication
and can be safely rolled back with `vlab reconcile --abort`.

Forecasts operate on committed heads. Dirty files are left untouched and their
count is reported rather than silently included. Run the prepared experiment
with:

```bash
npm run demo:forecast
```

## Resumable conflict reconciliation

When a proven-new change conflicts, `vlab reconcile` leaves a durable operation in the current worktree instead of losing causal context:

```bash
vlab reconcile feature
vlab reconcile --status

# Resolve and stage conflicted files.
git add <resolved-files>
vlab reconcile --continue
```

The completed application receipt links the source commit and Change ID to the context-specific result commit and records the conflicted paths. If the resolution changes the logical intent rather than adapting it to the target context, fork the identity explicitly:

```bash
vlab reconcile --continue --fork
```

Abort restores the exact target commit from which the complete reconciliation began, including when earlier changes in the queue applied cleanly:

```bash
vlab reconcile --abort
```

Pending state is stored under the current worktree's private Git directory. Two agents can therefore pause independent reconciliations in separate worktrees without overwriting each other's operation state. Completed receipts remain shared repository metadata.

Run the prepared conflict experiment with:

```bash
npm run demo:conflict
```

## Reusing an exact conflict resolution

Version 0.3 records an exact signature for the ordered base, target, and source
blobs involved in each conflict. The signature excludes the path, so a prior
resolution can be found on another branch or in another linked worktree when
all three inputs are identical.

When reconciliation pauses, inspect any matches:

```bash
vlab resolve status
```

No suggestion is applied automatically. Choose one explicitly, inspect the
staged result, and continue:

```bash
vlab resolve apply shared.txt
git diff --cached -- shared.txt
vlab reconcile --continue
```

For several unambiguous conflicts, use `vlab resolve apply --all`. If the same
signature has more than one known result, select one with
`--resolution <id>`. To decline prior results while keeping the decision in the
receipt, run:

```bash
vlab resolve reject shared.txt
# Resolve shared.txt manually, then:
git add shared.txt
vlab reconcile --continue
```

The application receipt distinguishes `created`, `accepted`, `modified`, and
`rejected` outcomes. `vlab resolve list` shows the repository-shared catalog.
An exact result is still never selected implicitly: v0.4 may batch-apply it only
when `--use-forecast` names the reviewed, pinned forecast.
Run the prepared two-conflict experiment, whose second occurrence is in a
linked worktree, with:

```bash
npm run demo:resolution
```

## AI-oriented workspaces

```bash
vlab workspace create agent-auth --from main --focus service:auth
vlab workspace list
cd ../vlab-playground.workspaces/agent-auth
echo draft > agent-plan.md
vlab workspace checkpoint --label "agent handoff"
```

From the original or another linked worktree, move or temporarily dematerialize
a workspace without changing its identity:

```bash
vlab workspace move agent-auth ../vlab-playground.workspaces/agent-auth-2
vlab workspace archive agent-auth
vlab workspace restore agent-auth --path ../vlab-playground.workspaces/agent-auth-3
vlab workspace repair agent-auth --path ../vlab-playground.workspaces/agent-auth-3
vlab workspace prune --dry-run
```

Archive refuses tracked changes and ignored files, so it cannot silently discard
private bytes. Prune is also conservative: it only changes stale registry entries
when `--apply` is explicit. Branch and checkpoint refs remain available while a
workspace is archived.

Compare two workspace branches without disturbing either worktree:

```bash
vlab workspace forecast agent-auth agent-payments
vlab workspace forecast agent-auth agent-payments --source-checkpoint
```

The ordering is `target <= source`: this previews applying the committed head
of `agent-payments` onto `agent-auth`. With `--source-checkpoint`, the source is
the latest immutable checkpoint whose base still matches the source head. Live
dirty bytes after that checkpoint remain excluded. The target is always its
committed head. The forecast is stored privately in the target worktree, where
its printed reconciliation command should be run.

The checkpoint captures tracked, modified, and untracked non-ignored files in
an immutable Git commit referenced under `refs/vcs-lab/checkpoints/...`. When a
new checkpoint replaces it, a history ref retains the previous checkpoint. The
operation does not alter `HEAD`, the index, or the working directory.

This approximates the proposed distinction:

- **Workspace:** pinned base, private draft state, ownership/focus metadata, and checkpoint history.
- **Worktree:** one ordinary filesystem materialization of that workspace.

The prototype still creates a `vlab/ws/<name>` compatibility branch because Git requires one to retain normal linked-worktree behavior. A native implementation would use a workspace ref and private draft stack instead.

## Annotated Markdown

Create a specification:

```markdown
# Checkout

REQ-CHECKOUT-1: Order submission must be idempotent.

## Failure behavior

Return a typed error when authorization fails.
```

Then index it:

```bash
vlab spec index docs/checkout.md
vlab spec show docs/checkout.md
```

The exact Markdown remains canonical. The tracked
`.vcs-lab/specs/docs/checkout.md.json` sidecar assigns stable IDs to the
preamble, headings, and explicit `REQ-*:` entries. Version 0.6 manifests are
sparse and deterministic: titles, positions, content hashes, and ordinary IDs
are derived from Markdown rather than duplicated. The sidecar retains
artifact/source identity, entity count, an optional Git blob identity, and only
exceptional legacy ID overrides.

An unchanged source hash is an incremental-index cache hit and does not rewrite
the sidecar. Repository-wide indexing additionally compares tracked Git blob
IDs first; unchanged documents are neither opened nor hashed. Index every
tracked or non-ignored Markdown document in one pass:

```bash
vlab spec index --all
```

### Deterministic block reconciliation

Version 0.5 introduced heading-delimited sections as disjoint merge units. `REQ-*`
records remain independently addressable entities, but their text is merged as
part of the containing section so overlapping units cannot produce inconsistent
bytes.

The three-way merge is deliberately conservative:

- edits to different blocks combine;
- a block move on one side combines with a content edit on the other;
- identical concurrent edits or additions combine;
- same-block divergent edits remain blocked;
- delete-versus-edit and incompatible ordering remain blocked.

The result is rendered with LF endings, one blank line between blocks, and one
final newline. No language model judgment is involved. The normal forecast
automatically discovers these decisions, records their exact input signature
and result hashes, and can apply them only through the reviewed forecast:

```bash
vlab forecast feature
vlab reconcile feature --use-forecast forecast_...
```

To inspect the semantic merge independently of reconciliation:

```bash
vlab spec merge-plan docs/checkout.md <base> <target> <source>
```

Without a forecast, reconciliation pauses before changing conflicted spec
bytes. Inspect and explicitly stage a clean deterministic suggestion:

```bash
vlab spec status
vlab spec resolve --all
git diff --cached -- docs/checkout.md .vcs-lab/specs/docs/checkout.md.json
vlab reconcile --continue
```

If you edit the staged suggestion, re-run `vlab spec index`, stage both the
Markdown and sidecar, and continue. The application receipt records the
semantic decision as `accepted` or `modified`; a stale sidecar cannot be
committed through reconciliation.

Run the prepared experiment with:

```bash
npm run demo:spec
```

## Commands

Run `vlab --help` for the current command list. The most useful commands are:

| Command | Experiment |
| --- | --- |
| `vlab commit` | Stable logical change identity |
| `vlab merge --compact` | First-parent compression without causal loss |
| `vlab merge --hard-squash` | Git-compatible strict squash plus sideband receipt |
| `vlab merge-plan` | Proven coverage versus heuristic similarity |
| `vlab rebase-plan` | Read-only causal omission/review/replay planning for a linear rebase |
| `vlab rebase-forecast` | Non-mutating simulation and private pinning of a causal rebase plan |
| `vlab rebase` | Supervised current-branch replay with stale checks, continue/fork/abort recovery, and completed receipts |
| `vlab forecast` | Non-mutating reconciliation simulation and pinned approval |
| `vlab reconcile` | Apply only proven-new changes with resumable conflicts |
| `vlab resolve ...` | Inspect, apply, reject, and audit exact resolution suggestions |
| `vlab cherry-pick` | Preserve or deliberately fork a Change ID |
| `vlab graph` | Branch history plus causal relationships, without metadata-ref noise |
| `vlab workspace ...` | Worktree-backed lifecycle, checkpoints, and committed/checkpoint forecasts |
| `vlab spec ...` | Incremental indexing, block merge planning, explicit resolution, and corpus benchmarks |
| `vlab receipts` | Inspect causal records as text or JSON |
| `vlab metadata ...` | Inventory, validate, transfer, and benchmark accepted metadata facts and scan paths |
| `vlab doctor --benchmark` | Sample ordinary Git latency and persistent object-session reuse |

## Metadata integrity and portability

Inspect every metadata scope without changing the repository:

```bash
vlab metadata status
vlab metadata validate --json
vlab metadata validate --strict
```

The inventory covers causal note attachments and record schemas, referenced
commits/trees/blobs, exact-resolution signatures and retention refs, tracked
spec/source consistency, workspace/checkpoint health, and counts of
worktree-private operations and forecasts. JSON diagnostics use stable codes.
Unknown, malformed, dangling, signature-mismatched, or ID-conflicting records
remain inspectable but cannot prove coverage, appear as exact resolutions, or
enter an export. Strict validation additionally fails on warnings such as a
missing workspace path or active private operation.

Create an offline envelope, clone the ordinary project content, preview the
exact destination actions, then apply them:

```bash
vlab metadata export ../project-metadata
git clone /path/to/project ../project-copy
cd ../project-copy
vlab metadata import ../project-metadata --dry-run
vlab metadata import ../project-metadata --apply
```

An envelope directory contains `manifest.json` and, when portable facts exist,
`objects.bundle`. Export is deterministic for fixed accepted facts. It carries
sanitized `refs/notes/vcs-lab` data, the commit history required by accepted
causal records (including rewritten rebase origins), and accepted
`refs/vcs-lab/resolutions/*` commits/blobs. Tracked spec manifests already move
with ordinary Git content. Workspace registries, checkpoint refs, active
reconciliation/rebase journals, and saved forecasts are excluded.

Import requires the same Git object format and at least one shared root commit,
which supports ordinary clones and forks while unrelated and history-filtered
histories fail closed in envelope v1. Dry-run verifies the manifest, bundle,
records, refs, and required content objects without changing destination refs.
Apply uses staging refs and one checked ref transaction; repeated import is a
no-op, and a conflicting record ID or resolution ref is never overwritten.

These checks establish internal integrity, not cryptographic signature trust,
actor identity, landing authorization, or permission to execute content.

## Metadata locations

- Git notes: `refs/notes/vcs-lab`
- Pending reconciliation: the current worktree Git directory under `vcs-lab/reconciliation.json`
- Pending causal rebase: the current worktree Git directory under `vcs-lab/rebase.json`
- Saved forecasts: the current worktree Git directory under `vcs-lab/forecasts/<forecast-id>.json`
- Workspace registry: the common Git directory under `vcs-lab/workspaces.json`
- Checkpoints: `refs/vcs-lab/checkpoints/<workspace-id>`
- Reusable resolution blobs: `refs/vcs-lab/resolutions/<signature>/<result-blob>`
- Portable spec manifests: `.vcs-lab/specs/**/*.json`

The supported v0.8 transfer path is `vlab metadata export/import`. For low-level
experimentation, the underlying namespaces remain:

```bash
git fetch origin refs/notes/vcs-lab:refs/notes/vcs-lab
git fetch origin 'refs/vcs-lab/resolutions/*:refs/vcs-lab/resolutions/*'
```

Both refs are required for reusable resolution data: notes carry the records
and the hidden resolution refs retain the result blobs. Fetching them manually
does not perform envelope validation, conflict preview, or quarantine.

## Measuring the compatibility layer

Version 0.7 keeps mutation commands as ordinary Git processes but can route
repeated immutable object queries through one worktree-scoped
`git cat-file --batch-command` process. It is enabled automatically on Windows,
where the observed 80–130 ms process startup cost dominates these operations.
On other platforms it remains opt-in because a local Git process may take only
a few milliseconds.

The worker starts lazily at the first uncached object request. This keeps worker
startup from overlapping synchronous preflight commands such as `git status`.
Shutdown waits for the child `close` event so its stdio has drained, with bounded
Git-tree and worker fallbacks if graceful EOF does not complete.

Get both the ordinary-process baseline and the persistent-session probe with:

```bash
vlab doctor --benchmark --samples 10 --warmup 2
```

Measure repository/shared-metadata volume without reading or changing the
caller repository:

```bash
vlab metadata benchmark --json
vlab metadata benchmark --history 500 --workspaces 20 --notes 500 --resolutions 100 --samples 5 --budget-ms 1500 --json
```

The default disposable profile contains 250 reachable commits, 12 registered
linked-worktree workspaces, 250 causal notes, and 50 retained resolutions. It
measures history, stock Git worktree discovery, the registry, complete
workspace status, notes, resolutions, and complete metadata status. Setup cost
is separate, every sample must return the same semantic result, and JSON omits
fixture paths, object IDs, file content, and commit messages. Documentation
volume is covered by `vlab spec benchmark`.

On the clean-commit Windows host run, registry parsing took a 0.31 ms median
with no Git processes and the 300-target note catalog took 172.67 ms with two.
Status for 12 workspaces took 1,597.78 ms and 36 processes; 50 resolutions took
5,503.66 ms and 103 processes. This synthetic observation selects batching for
workspace status and resolution traversal. It does not justify an incremental
index, a resident service, or a production scale claim. See
[ADR-0013](docs/adr/0013-measure-scan-amplification-before-adding-indexes-or-a-service.md).

For command-by-command timings, enable tracing directly on one invocation:

```bash
vlab forecast feature --trace-git
```

`--git-session` forces the persistent path and `--no-git-session` forces the
ordinary compatibility path. If a session fails, the command continues through
ordinary Git. Trace output contains command names, durations, and whether a
query started a process, reused the session, or hit the immutable object cache;
it never includes file content or commit messages.

Run an equality-checked comparison over a 12-change forecast with:

```bash
npm run demo:git-session
```

On the latest correction host run, the persistent path produced the identical
forecast with 25 Git processes instead of 64, a 60.9% reduction. Wall time
remains a machine-specific measurement; process count and result-tree equality
are the portable acceptance invariants.

Forecast output separately reports preflight, planning, simulation, invariant,
temporary-worktree, logical-query, and actual-process totals. Completed
reconciliation receipts report active application time, excluding time spent
waiting for a person between a conflict and `--continue`, plus total elapsed
wall time.

Measure indexing and raw/estimated-compressed metadata size without changing the
current repository:

```bash
vlab spec benchmark --documents 25 --blocks 40
```

The benchmark creates and removes a disposable repository. It reports cold,
unchanged, and one-block-change indexing; Git-blob cache hits and actual content
reads; semantic entity counts; sparse v3 bytes versus an equivalent expanded v2
representation; and a deflate-based approximation of Git object compression.
For the default 25-document, 2,025-entity corpus, v0.6 reduces the tracked
manifest representation from 655,545 equivalent v2 bytes to 11,240 v3 bytes.

## What this prototype intentionally does not solve

- cryptographic signing or a trusted landing server;
- a native content-addressed object database;
- content-defined chunking;
- semantic merge drivers for formats other than heading-oriented Markdown;
- nested requirement-level byte merging within a section;
- a binary or content-addressed native structured-document object store;
- server-side branch policy and atomic multi-ref landing;
- virtual/lazy filesystem materialization;
- target-checkpoint overlays or forecasts over uncaptured live workspace bytes;
- a complete Git protocol gateway;
- persistent repository indexes or a cross-command resident service before
  representative post-batching evidence justifies them;
- safe automatic equivalence inference for independently created near-identical code.

Those should be built only after these local semantics prove useful.

## Run the tests

```bash
npm test
```

The 43-test integration suite creates disposable Git repositories and exercises
hard-squash reconciliation, compact ancestry, resumable conflicts, mid-queue
abort, contextual identity forks, exact resolution reuse and provenance,
non-mutating and stale-safe forecasts, pinned batch application, committed-head
and immutable source-checkpoint workspace comparison, reversible workspace
lifecycle, independent worktree operations, checkpoint history, annotated
Markdown stability, sparse-manifest migration, zero-read incremental indexing,
clean and blocked deterministic block merges, forecasted and explicit semantic
application, conservative patch-equivalence handling, corpus measurements,
batched history planning, persistent-session fallback, worktree isolation, Git
timing probes, damaged metadata quarantine, deterministic envelope export,
tamper/lineage/conflict rejection, idempotent two-clone parity, and read-only
causal rebase planning plus deterministic/non-mutating rebase forecasts with
explicit candidate decisions, predicted trees, private persistence, and
conflict blockers; and supervised rebase application with stable identity,
stale rejection, exact-resolution batching, contextual forks, empty-step
blocking, exact abort, linked-worktree isolation, completed-record validation,
portable unreachable origins, plus a caller-isolated repository-scale fixture
that verifies semantic scan results, process-amplification decisions, privacy,
and cleanup. The complete suite is also run with
`VLAB_GIT_SESSION=1` to exercise the Windows-default path.
