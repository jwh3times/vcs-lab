# vcs-lab

`vcs-lab` is a local, dependency-free prototype for experimenting with the source-control ideas discussed in this project:

- Git remains a real compatibility and storage layer.
- logical changes keep a stable `Change-Id` across rebase and cherry-pick;
- compact merges retain a real causal parent while displaying as one first-parent landing;
- hard squashes record exactly what they absorbed in a causal landing receipt;
- a merge planner subtracts proven prior work instead of relying only on Git topology;
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

## AI-oriented workspaces

```bash
vlab workspace create agent-auth --from main --focus service:auth
vlab workspace list
cd ../vlab-playground.workspaces/agent-auth
echo draft > agent-plan.md
vlab workspace checkpoint --label "agent handoff"
```

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
| `vlab reconcile` | Apply only proven-new changes |
| `vlab cherry-pick` | Preserve or deliberately fork a Change ID |
| `vlab graph` | Branch history plus causal relationships, without metadata-ref noise |
| `vlab workspace ...` | Worktree-backed logical workspaces and checkpoints |
| `vlab spec ...` | Hybrid file/semantic-document representation |
| `vlab receipts` | Inspect causal records as text or JSON |

## Metadata locations

- Git notes: `refs/notes/vcs-lab`
- Workspace registry: the common Git directory under `vcs-lab/workspaces.json`
- Checkpoints: `refs/vcs-lab/checkpoints/<workspace-id>`
- Portable spec manifests: `.vcs-lab/specs/**/*.json`

For another clone to receive experimental causal metadata, explicitly fetch the notes ref:

```bash
git fetch origin refs/notes/vcs-lab:refs/notes/vcs-lab
```

## What this prototype intentionally does not solve

- cryptographic signing or a trusted landing server;
- a native content-addressed object database;
- content-defined chunking;
- deterministic AST merge drivers;
- server-side branch policy and atomic multi-ref landing;
- virtual/lazy filesystem materialization;
- a complete Git protocol gateway;
- safe automatic equivalence inference for independently created near-identical code.

Those should be built only after these local semantics prove useful.

## Run the tests

```bash
npm test
```

The integration suite creates disposable Git repositories and exercises hard-squash reconciliation, compact ancestry, worktree checkpoints, annotated Markdown stability, and conservative patch-equivalence handling.
