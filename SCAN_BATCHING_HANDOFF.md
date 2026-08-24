# Fresh-worktree handoff: batch workspace and resolution scans

## Resume objective

Implement the bounded next action selected by
[ADR-0013](docs/adr/0013-measure-scan-amplification-before-adding-indexes-or-a-service.md):

1. reduce per-workspace Git process amplification in complete workspace status;
2. replace per-resolution ref/note traversal with batched discovery and
   validation; and
3. rerun `vcs-lab.repository-scale-benchmark/v1` before considering any
   persistent index or resident service.

Do not add a database, daemon, background service, remote protocol, or fixed
production scale claim in this increment.

## Validated starting point

The required history is on `main`. A fresh checkout must contain these
ancestors:

| Commit | Meaning |
| --- | --- |
| `fd8ade038995df36c98f992e051c8a4cf5d93065` | Repository-scale benchmark implementation and ADR-0013 |
| `2c97aa3f2f0fae3917d07735ae85f9170232d817` | Clean TP-01–TP-18 qualification and representative evidence |

The handoff document's own commit may be newer. Resolve the actual checkout
rather than assuming this file's containing commit remains `HEAD`.

The tested baseline is Node.js 20+, Git 2.38+, package/CLI version `0.8.0`, 43
integration scenarios, and six maintained demos. The complete evidence is in
[REPOSITORY_SCALE_TEST_RESULTS.md](REPOSITORY_SCALE_TEST_RESULTS.md).

During integration into `main`, four pre-existing intermediate forced-session
files from commit `ca1df46` were preserved in a named stash rather than
discarded. Look for stash message
`pre-main-integration-ca1df46-20260824`. It predates and is superseded by the
qualified forced-session implementation on `main`; do not pop or drop it
without a deliberate maintainer review.

## Create and verify a fresh worktree

From the canonical repository, choose a new absolute path and unused branch
name:

```powershell
Set-Location C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab
git status --short --branch
git log -5 --oneline --decorate
git stash list

$freshPath = "C:\path\to\a\new\vcs-lab-scan-batching-worktree"
git worktree add -b scan-batching $freshPath main
Set-Location $freshPath

git status --short --branch
git merge-base --is-ancestor fd8ade038995df36c98f992e051c8a4cf5d93065 HEAD
if ($LASTEXITCODE -ne 0) { throw "Repository-scale implementation is missing" }
git merge-base --is-ancestor 2c97aa3f2f0fae3917d07735ae85f9170232d817 HEAD
if ($LASTEXITCODE -ne 0) { throw "Repository-scale qualification is missing" }
node --version
git --version
node .\bin\vlab.js --help
```

If the named branch or path already exists, choose another; do not reset or
delete an existing worktree to reuse the example.

## Read before editing

Read these in order:

1. [SESSION_HANDOFF.md](SESSION_HANDOFF.md), especially invariants, known gaps,
   and test discipline.
2. [PRD.md](PRD.md): FR-WS-09, FR-PERF-09, FR-PERF-10, and NFR-PERF-03 through
   NFR-PERF-05.
3. [ARCHITECTURE.md](ARCHITECTURE.md): source map, Git-session boundaries,
   observability, and current architectural debt.
4. [ADR-0013](docs/adr/0013-measure-scan-amplification-before-adding-indexes-or-a-service.md).
5. [REPOSITORY_SCALE_TEST_RESULTS.md](REPOSITORY_SCALE_TEST_RESULTS.md).
6. `src/workspaces.js`, `src/resolutions.js`, `src/notes.js`, `src/metadata.js`,
   `src/git.js`, `src/scale-benchmark.js`, and the scale assertions in
   `test/integration.test.js`.

## Current evidence and selected action

The clean representative Windows fixture used 250 commits, 12 registered linked
worktrees, 250 causal notes, 50 resolutions, and three samples:

| Phase | Median | Git processes | Decision |
| --- | ---: | ---: | --- |
| Registry read | 0.31 ms | 0 | Do not add a registry index |
| Workspace status | 1,597.78 ms | 36 | Batch first |
| Note catalog | 172.67 ms | 2 | Retain existing batch path |
| Resolution catalog | 5,503.66 ms | 103 | Batch first |
| Complete metadata status | 780.25 ms | 11 | Preserve semantics; observe downstream change |

The measured process ratios are three per workspace, 0.007 per note target, and
2.06 per resolution. Only workspace status and resolution catalog exceeded the
1,000 ms median budget.

## Implementation slice A: workspace status

`listWorkspaces()` maps every registry record through `inspectWorkspace()`.
For each existing active path, that currently launches:

1. `git rev-parse --is-inside-work-tree`;
2. a separate `HEAD` query; and
3. `git status --porcelain=v1`.

Replace those three calls with one worktree-scoped query that validates the
path, reports the exact branch OID, and carries porcelain status in the same
response. `git status --porcelain=v2 --branch -z` is the leading compatibility
candidate; verify its branch-header and NUL-record behavior across clean,
dirty, detached, missing, and invalid fixtures before adopting it. Each linked
worktree has a private index, so do not infer dirty state from another
worktree, a shared index, or a cached symbolic ref.

Preserve these distinctions exactly:

- archived descriptor;
- registered path missing from the filesystem;
- existing path that is not a usable linked Git worktree;
- active clean or dirty linked worktree;
- registered workspace `head`, lifecycle, `pathStatus`, and `dirtyFiles`; and
- machine-local absolute path behavior.

The representative 12-workspace target is at most 12 median Git processes: one
combined query per active workspace instead of three. Do not add parallel
process orchestration merely to improve wall time until this structural
reduction is measured.

## Implementation slice B: resolution catalog

`listResolutionRecords()` currently:

1. lists resolution ref names;
2. resolves each ref in a separate Git call;
3. shows each attached note in a separate Git call;
4. validates referenced objects in a batch; and
5. validates retained result blobs in a batch.

Change the ref listing to return both `%(refname)` and `%(objectname)` in one
unambiguous, bounded format. Reuse the existing notes namespace listing and
batched note-object read, then join resolution records to the ref commit by
`attachedTo`. Keep the existing structural/object validation and batched
`<resolution-commit>:result` retention check.

Preserve all current rejection rules:

- record type must be `resolution`;
- the record's `ref` equals the discovered ref;
- `resolutionCommit`, note attachment, and discovered ref object agree;
- ordered base/ours/theirs signature recomputes exactly;
- every referenced Git object exists with its required type;
- a non-deleted result is the exact retained `result` blob; and
- ordering remains newest `createdAt` first.

Process count must stop growing as roughly `2N + 3`. The 50-resolution
representative profile should be bounded to single-digit Git processes unless a
documented Git compatibility constraint proves otherwise.

## Test-first acceptance contract

Before optimizing, extend the existing disposable-repository coverage so it
would fail if either batch path changed semantics. Include:

- active, dirty, archived, missing, and invalid workspace-path cases;
- exact equality of workspace list JSON before and after optimization;
- multiple resolution refs/notes, deleted results, invalid/mismatched records,
  and deterministic ordering;
- quarantine behavior through `metadata status/validate`;
- ordinary and forced Git-session equality;
- caller `HEAD`, index/status, files, and worktree-list preservation; and
- no repository path, object ID, content, or commit message in benchmark JSON.

Do not raise or delete an assertion just because process counts changed. Update
the scale test to assert the new bounded counts and that the recommendation no
longer marks a successfully batched phase as `batch-first`. If both phases fall
under budget, the expected next action should become collection of larger and
multi-host evidence, not automatic index/service creation.

## Validation sequence

During implementation:

```powershell
node --check src\workspaces.js
node --check src\resolutions.js
node --check src\scale-benchmark.js
node --test --test-name-pattern="workspace|resolution|repository-scale" test\integration.test.js
```

Before committing the behavior change:

```powershell
$env:VLAB_GIT_SESSION = "0"
npm test
Remove-Item Env:VLAB_GIT_SESSION -ErrorAction SilentlyContinue

$env:VLAB_GIT_SESSION = "1"
npm test
Remove-Item Env:VLAB_GIT_SESSION -ErrorAction SilentlyContinue

node .\bin\vlab.js metadata benchmark --json
node .\bin\vlab.js spec benchmark --documents 25 --blocks 40 --json
git diff --check
```

Compare the new representative schema with
[REPOSITORY_SCALE_TEST_RESULTS.md](REPOSITORY_SCALE_TEST_RESULTS.md). Record
fixture shape, semantic results, cold/warm/median/p95, process counts, decision
output, privacy, cleanup, and caller invariants. Then run the complete
[TEST_PLAN.md](TEST_PLAN.md) TP-01 through TP-18 gate from the exact committed
candidate in a clean disposable checkout.

## Non-negotiable boundaries

- Git remains the storage/compatibility oracle.
- Batch changes may not alter workspace or resolution domain results.
- Worktree-private `HEAD`, index, and operation state cannot be shared across
  linked worktrees.
- Mutable symbolic refs and index expressions cannot enter the immutable object
  cache.
- Invalid resolution metadata remains inspectable but cannot become reusable or
  prove causal coverage.
- Benchmark setup stays separate from measured scans and uses only a bounded
  disposable repository.
- No caller content or identity enters benchmark output.
- No persistent index or service is introduced from this single-host evidence.
- Do not create a release, tag, push, or publication unless separately asked.

## Handoff completion

The next agent is finished only when:

1. both scans preserve exact semantic behavior;
2. their process amplification is structurally reduced and measured;
3. ordinary and forced suites pass;
4. the representative repository/spec benchmarks are rerun;
5. the clean TP-01–TP-18 gate passes at the exact implementation commit;
6. ADR/PRD/architecture/readme/changelog/session handoff and a new results
   record agree; and
7. the feature branch is clean, with no release or remote mutation.
