# vcs-lab

`vcs-lab` is a local, dependency-free prototype for experimenting with the source-control ideas discussed in this project:

- Git remains a real compatibility and storage layer.
- logical changes keep a stable `Change-Id` across rebase and cherry-pick;
- compact merges retain a real causal parent while displaying as one first-parent landing;
- hard squashes record exactly what they absorbed in a causal landing receipt;
- a merge planner subtracts proven prior work instead of relying only on Git topology;
- reconciliation can be forecast in an isolated worktree and pinned before application;
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
git clone /path/to/causal-vcs-lab-0.4.0.bundle vcs-lab
cd vcs-lab
git remote remove origin
npm link
npm test
```

If you instead use the source ZIP, initialize its extracted directory with:

```bash
git init -b main
git add .
git commit -m "Bootstrap causal-vcs-lab 0.4.0"
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

Version 0.4 can simulate the complete proven-new queue before touching the
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

The exact Markdown remains canonical. The tracked `.vcs-lab/specs/docs/checkout.md.json` sidecar assigns stable IDs to headings and explicit `REQ-*:` entries. Re-index after editing to see which entities were added, changed, moved, or removed.

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
| `vlab spec ...` | Hybrid file/semantic-document representation |
| `vlab receipts` | Inspect causal records as text or JSON |
| `vlab doctor --benchmark` | Sample Git subprocess latency in the current repository |

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

The current lab starts a Git process for each storage or graph operation. Get a
small repeatable baseline for the current repository with:

```bash
vlab doctor --benchmark
```

For command-by-command timings, enable tracing for one invocation:

```bash
VLAB_TRACE=1 vlab merge-plan feature
```

Trace output contains durations and Git command names, not file content or
commit messages. These probes are intended to reveal when the compatibility
layer or a synchronized filesystem becomes the bottleneck.

Forecast output separately reports simulation wall time. Completed
reconciliation receipts report active application time, excluding time spent
waiting for a person between a conflict and `--continue`, plus total elapsed
wall time.

## What this prototype intentionally does not solve

- cryptographic signing or a trusted landing server;
- a native content-addressed object database;
- content-defined chunking;
- deterministic AST merge drivers;
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

The 19-test integration suite creates disposable Git repositories and exercises
hard-squash reconciliation, compact ancestry, resumable conflicts, mid-queue
abort, contextual identity forks, exact resolution reuse and provenance,
non-mutating and stale-safe forecasts, pinned batch application, committed-head
workspace comparison, independent worktree operations, checkpoints, annotated
Markdown stability, conservative patch-equivalence handling, and Git timing
probes.
