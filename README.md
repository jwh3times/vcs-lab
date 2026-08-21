# vcs-lab

`vcs-lab` is a local, dependency-free prototype for experimenting with the source-control ideas discussed in this project:

- Git remains a real compatibility and storage layer.
- logical changes keep a stable `Change-Id` across rebase and cherry-pick;
- compact merges retain a real causal parent while displaying as one first-parent landing;
- hard squashes record exactly what they absorbed in a causal landing receipt;
- a merge planner subtracts proven prior work instead of relying only on Git topology;
- Windows planning and forecasting reuse a worktree-scoped Git object process instead of spawning once per read;
- reconciliation can be forecast in an isolated worktree and pinned before application;
- indexed Markdown can be merged deterministically by stable block identity;
- conflicted reconciliation can pause, survive process exit, continue, or abort safely;
- exact conflict resolutions can be suggested across branches and worktrees with explicit provenance;
- workspaces use real Git worktrees but add path-independent logical metadata and non-disruptive checkpoints;
- Markdown remains canonical while a sidecar gives sections and requirements stable entity IDs.

This is a laboratory, not a production VCS. Its purpose is to make the semantics observable and falsifiable before designing a native object store or network protocol.

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
git clone /path/to/causal-vcs-lab-0.7.0.bundle vcs-lab
cd vcs-lab
git remote remove origin
npm link
npm test
```

If you instead use the source ZIP, initialize its extracted directory with:

```bash
git init -b main
git add .
git commit -m "Bootstrap causal-vcs-lab 0.7.0"
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

Compare two workspace branches without disturbing either worktree:

```bash
vlab workspace forecast agent-auth agent-payments
```

The ordering is `target <= source`: this previews applying the committed head
of `agent-payments` onto `agent-auth`. The forecast is stored privately in the
target worktree, where its printed reconciliation command should be run.

The checkpoint captures tracked, modified, and untracked non-ignored files in an immutable Git commit referenced under `refs/vcs-lab/checkpoints/...`. It does not alter `HEAD`, the index, or the working directory.

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
| `vlab forecast` | Non-mutating reconciliation simulation and pinned approval |
| `vlab reconcile` | Apply only proven-new changes with resumable conflicts |
| `vlab resolve ...` | Inspect, apply, reject, and audit exact resolution suggestions |
| `vlab cherry-pick` | Preserve or deliberately fork a Change ID |
| `vlab graph` | Branch history plus causal relationships, without metadata-ref noise |
| `vlab workspace ...` | Worktree-backed workspaces, checkpoints, and committed-head forecasts |
| `vlab spec ...` | Incremental indexing, block merge planning, explicit resolution, and corpus benchmarks |
| `vlab receipts` | Inspect causal records as text or JSON |
| `vlab doctor --benchmark` | Sample ordinary Git latency and persistent object-session reuse |

## Metadata locations

- Git notes: `refs/notes/vcs-lab`
- Pending reconciliation: the current worktree Git directory under `vcs-lab/reconciliation.json`
- Saved forecasts: the current worktree Git directory under `vcs-lab/forecasts/<forecast-id>.json`
- Workspace registry: the common Git directory under `vcs-lab/workspaces.json`
- Checkpoints: `refs/vcs-lab/checkpoints/<workspace-id>`
- Reusable resolution blobs: `refs/vcs-lab/resolutions/<signature>/<result-blob>`
- Portable spec manifests: `.vcs-lab/specs/**/*.json`

For another clone to receive experimental causal metadata, explicitly fetch the notes ref:

```bash
git fetch origin refs/notes/vcs-lab:refs/notes/vcs-lab
git fetch origin 'refs/vcs-lab/resolutions/*:refs/vcs-lab/resolutions/*'
```

Both refs are required to transfer reusable resolution data: notes carry the
records and the hidden resolution refs retain the result blobs.

## Measuring the compatibility layer

Version 0.7 keeps mutation commands as ordinary Git processes but can route
repeated immutable object queries through one worktree-scoped
`git cat-file --batch-command` process. It is enabled automatically on Windows,
where the observed 80–130 ms process startup cost dominates these operations.
On other platforms it remains opt-in because a local Git process may take only
a few milliseconds.

Get both the ordinary-process baseline and the persistent-session probe with:

```bash
vlab doctor --benchmark --samples 10 --warmup 2
```

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

On the release test host the persistent path produced the identical forecast
with 25 Git processes instead of 52, a 51.9% reduction. Wall time remains a
machine-specific measurement; process count and result-tree equality are the
portable acceptance invariants.

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
- forecasting uncommitted workspace drafts or checkpoints;
- a complete Git protocol gateway;
- safe automatic equivalence inference for independently created near-identical code.

Those should be built only after these local semantics prove useful.

## Run the tests

```bash
npm test
```

The 29-test integration suite creates disposable Git repositories and exercises
hard-squash reconciliation, compact ancestry, resumable conflicts, mid-queue
abort, contextual identity forks, exact resolution reuse and provenance,
non-mutating and stale-safe forecasts, pinned batch application, committed-head
workspace comparison, independent worktree operations, checkpoints, annotated
Markdown stability, sparse-manifest migration, zero-read incremental indexing,
clean and blocked deterministic block merges, forecasted and explicit semantic
application, conservative patch-equivalence handling, corpus measurements,
batched history planning, persistent-session fallback, worktree isolation, and
Git timing probes. The complete suite is also run with
`VLAB_GIT_SESSION=1` to exercise the Windows-default path.
