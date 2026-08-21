# New-session handoff: vcs-lab

## Purpose of this document

This is the operational handoff for continuing the repository in a fresh
development or AI-agent session. It preserves the product motivation, current
release state, implementation map, validation baseline, non-negotiable
invariants, known gaps, and the recommended next increment.

It is deliberately self-contained enough to recover context, but it does not
replace the authoritative documents:

1. [PRD.md](PRD.md) — product scope, requirements, priorities, success metrics,
   and roadmap gates.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — current components, state, flows,
   schemas, safety model, and limitations.
3. [docs/adr/README.md](docs/adr/README.md) — normative decisions and their
   consequences.
4. [README.md](README.md) — user commands and experiments.
5. [DESIGN.md](DESIGN.md) — chronological experiment rationale.
6. [CHANGELOG.md](CHANGELOG.md) — delivered changes by release.

If this handoff becomes stale, update it rather than allowing a new session to
guess.

## 1. Original user intent

The work began as a design exploration for a highly optimized modern source
control protocol informed by SVN and Git and designed for the volume and
parallelism of specification-driven AI development.

The user explicitly values:

- Git compatibility because Git is the adoption standard;
- easy branching;
- a simpler, safer merge and rebase experience;
- avoiding false “completely different history” behavior when a branch was
  squash-merged and later merges back despite near-identical code;
- cherry-picking with preserved intent and explicit divergence;
- worktrees as a first-class experience because AI agents use them heavily;
- high performance on Windows and in a OneDrive-hosted development directory;
- support for a very large volume of specifications and generated documents.

The product direction chosen is a hybrid: prove new causal and semantic
behavior as a local Git compatibility layer before committing to a native
object store, server, or wire protocol.

## 2. User's preferred repository location

The user's canonical local Windows project directory is:

```text
C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab
```

Do not move or recreate the repository somewhere else on the user's machine
without a specific reason and approval. Disposable demo repositories belong
under the system temporary directory and should print their path.

## 3. Release and repository baseline

The released baseline is v0.8.0. The current v0.9 development branch adds the
accepted ADR-0011 model and a read-only causal `rebase-plan` slice to validated
metadata portability and the v0.7 causal/specification/Git-session foundation.
The development suite contains 34 integration tests and retains all six
maintained demos.

Do not trust a hard-coded commit from a handoff; establish the exact checkout
first:

```powershell
Set-Location C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab
git status --short --branch
git describe --tags --always --dirty
git log -1 --oneline --decorate
node --version
git --version
```

Expected requirements:

- Node.js 20 or newer;
- Git 2.38 or newer;
- no npm runtime dependencies;
- `main` clean before starting a release or broad reconciliation experiment.

If `git status` is not clean, preserve the user's changes. Inspect them and
work around them; never reset, discard, or overwrite them just to reach the
expected baseline.

## 4. What has been implemented

### v0.1 — causal identity foundation

- Stable `Change-Id` trailers.
- Compact two-parent landing and strict hard-squash landing.
- Landing receipts with absorbed commits and logical IDs.
- Merge planning with causal coverage and patch candidates.
- Cherry-pick continuity/fork.
- Worktree-backed workspaces and non-disruptive checkpoints.
- Initial stable Markdown block identity.

### v0.2 — durable conflict operations

- Worktree-local reconciliation journal.
- Status, process-separated continue, and safe abort.
- Contextual application versus explicit logical fork.
- No partial receipt publication before queue success.
- Multi-worktree operation isolation.
- Windows line-ending stabilization in v0.2.1.

### v0.3 — exact resolution memory

- Path-independent ordered base/target/source blob signature.
- Shared, garbage-collection-safe retained result blobs.
- Explicit apply/reject/list/status workflow.
- Ambiguous result selection by ID.
- Created/accepted/modified/rejected provenance.
- Git latency probes and concise human output.

### v0.4 — proactive forecasting

- Detached temporary-worktree simulation.
- Caller `HEAD`/index/files invariant checks.
- Exact source/target/plan/decision pinning.
- `--use-forecast` reviewed batch application.
- Predicted final-tree enforcement.
- Workspace-head forecasts and phase timing.

### v0.5 — deterministic specification merge

- Stable heading-section three-way merge.
- Independent edit and move-plus-edit combination.
- Explicit same-block/delete-edit/order blockers.
- Semantic forecast and paused-operation resolution.
- Pinned document/manifest hashes and audited modifications.
- Corpus benchmark and structured Git call metrics.

### v0.6 — sparse specification metadata

- Sparse manifest v3 and v1/v2 identity-preserving migration.
- Git-blob zero-content-read path for unchanged tracked documents.
- Batched base/target/source spec object reads.
- Representative semantic reconcile reduced to at most 10 Git processes.
- Default benchmark: 11,240 sparse bytes versus 655,545 expanded-equivalent
  bytes for 2,025 entities (98.29% less).

The user independently verified on Windows that one real manifest migrated
from 1,604 to 443 bytes (72.4% reduction) with all semantic IDs preserved. The
user also verified the deterministic spec forecast/reconcile result and the
zero-read unchanged index path.

### v0.7 — persistent Git object plumbing

- Invocation-scoped `git cat-file --batch-command` worker/session.
- Enabled by default on Windows, opt-in elsewhere.
- `--git-session`, `--no-git-session`, and `--trace-git` controls.
- Immutable cache limited to full-OID-rooted expressions.
- Mutation invalidation, per-worktree scoping, bounded channels, and ordinary
  Git fallback.
- Batched target/source history and note object reads.
- Metrics distinguish logical queries, processes, session queries, and cache
  hits.
- Release demo reduced a 12-change forecast from 52 to 25 processes (51.9%)
  with identical plan and predicted tree.
- Deterministic spec reconciliation performs 10 logical queries through 6
  actual Git processes in the release path.

The user has not yet supplied an independent v0.7 Windows session-demo report
in the preserved conversation. Capturing that evidence remains useful but does
not block documentation work.

### v0.8 — metadata integrity and portability

- Deterministic `metadata status` and `metadata validate` inventory across
  shared-portable, tracked-portable, shared-local, and worktree-private scopes.
- Stable diagnostic codes for unknown/malformed records, missing attachments
  and objects, resolution signature/retention damage, spec drift, workspace
  health, private operations, and record-ID conflicts.
- Unknown or invalid causal facts are quarantined from coverage, exact
  resolution lookup, and export without rewriting their source notes.
- `vcs-lab.metadata-envelope/v1` uses a canonical hashed manifest plus a
  deterministic sanitized Git bundle.
- Lineage v1 binds Git object format and sorted ordinary root commits; the same
  lineage or a fork with a shared root may import, while unrelated or
  history-filtered lineages fail closed.
- Import verifies its payload in a disposable repository, previews exact
  records/refs/objects, refuses conflicts, stages refs, and publishes through
  one checked ref transaction. Repeated import is a no-op.
- Tracked spec manifests continue to travel with ordinary source. Workspace
  registries, checkpoints, reconciliation journals, and forecasts are excluded
  from envelopes.
- Integrity remains explicitly distinct from signatures, actor identity, and
  authorization.

## 5. Fast start for a new session

### 5.1 Read and verify before editing

```powershell
Set-Location C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab

git status --short --branch
git log -5 --oneline --decorate
Get-Content package.json

Get-Content PRD.md -TotalCount 80
Get-Content ARCHITECTURE.md -TotalCount 80
Get-Content docs\adr\README.md
Get-Content SESSION_HANDOFF.md -TotalCount 120
```

Then run the baseline tests appropriate to the task. For any behavior change,
run both modes:

```powershell
npm test

$env:VLAB_GIT_SESSION = "1"
npm test
Remove-Item Env:VLAB_GIT_SESSION
```

The expected development baseline is 34 passing tests in each mode. A documentation-only
change may run the ordinary suite plus link/packaging checks, but a release
should still preserve the full gate in [PRD.md](PRD.md#14-release-and-quality-gates).

### 5.2 User-observable demos

```powershell
npm run demo
npm run demo:conflict
npm run demo:resolution
npm run demo:forecast
npm run demo:spec
npm run demo:git-session
```

Each script creates a disposable repository and prints its path and follow-up
commands. Do not treat demo branch/object IDs as stable across runs.

### 5.3 Windows measurements worth collecting

```powershell
vlab doctor --benchmark --samples 10 --warmup 2
npm run demo:git-session
```

Record both wall time and process count. The semantic acceptance signal is
identical plans/step trees/predicted tree between modes. Process count is more
portable than a single timing observation.

## 6. Source map for implementation work

| Concern | Start here | Also inspect |
| --- | --- | --- |
| CLI syntax/output | `src/cli.js` | `bin/vlab.js`, README command table |
| Git process/session/metrics | `src/git.js` | `src/git-session-worker.js`, session tests/demo |
| Coverage classifications | `src/merge-plan.js` | `src/notes.js`, landing/reconciliation schemas |
| Causal rebase planning | `src/rebase-plan.js` | `src/merge-plan.js`, rebase plan tests, ADR-0011 |
| Compact/hard-squash merge | `src/landings.js` | merge-plan tests |
| Forecast simulation/pinning | `src/forecasts.js` | `src/operations.js`, stale/mismatch tests |
| Reconcile start/continue/abort | `src/operations.js` | `src/reconcile-state.js`, conflict tests |
| Exact conflict memory | `src/resolutions.js` | `src/notes.js`, resolution tests/demo |
| Worktrees/workspaces/checkpoints | `src/workspaces.js` | `src/store.js`, workspace tests |
| Markdown identity/index/merge | `src/specs.js` | spec tests and `scripts/spec-merge-demo.mjs` |
| Shared note records | `src/notes.js` | `refs/notes/vcs-lab` behavior |
| Metadata inventory/validation | `src/metadata.js`, `src/schemas.js` | note/resolution/spec/workspace/private-state fixtures |
| Envelope export/import | `src/metadata-envelope.js`, `src/metadata-transfer.js` | lineage, bundle, staging/ref-transaction tests |
| Common/private runtime paths | `src/store.js`, `src/reconcile-state.js` | `repoContext` in `src/git.js` |
| IDs and hashes | `src/ids.js` | schema fields that name algorithms |
| End-to-end contract | `test/integration.test.js` | all demo scripts |
| User narrative | `README.md` | PRD, architecture, changelog |

Avoid broad refactoring before reading the relevant integration scenarios. The
suite is intentionally end-to-end because Git state, worktree boundaries,
line endings, and process interruption are part of the behavior.

## 7. Runtime state map

| State | Location | Scope |
| --- | --- | --- |
| Causal records | `refs/notes/vcs-lab` | Shared repository, not normal-fetch by default |
| Resolution retention | `refs/vcs-lab/resolutions/*` | Shared repository, not normal-fetch by default |
| Checkpoints | `refs/vcs-lab/checkpoints/*` | Shared repository/local experiment |
| Workspace registry | common Git dir, `vcs-lab/workspaces.json` | Shared among linked worktrees, machine-local paths |
| Pending reconciliation | current worktree Git dir, `vcs-lab/reconciliation.json` | Worktree-private |
| Forecasts | current worktree Git dir, `vcs-lab/forecasts/*.json` | Worktree-private |
| Spec manifests | `.vcs-lab/specs/**/*.json` | Tracked and portable with project source |

The supported portable transfer path is:

```powershell
vlab metadata export ..\project-metadata
vlab metadata import ..\project-metadata --dry-run
vlab metadata import ..\project-metadata --apply
```

Manual note/resolution refspecs remain possible for low-level experiments, but
they do not validate, quarantine, preview conflicts, or transfer every required
resolution object safely.

## 8. Invariants that must not regress

These are the shortest high-value review checklist for any new change:

1. Git remains a valid, usable repository without `vlab`.
2. Commit/tree identity, logical Change ID, application, and landing remain
   distinct concepts.
3. Compact merge retains a real source parent.
4. Hard squash publishes a receipt only after a completed commit.
5. Only exact accepted proofs silently mark work covered.
6. Patch equivalence remains visible and opt-in.
7. Forecasting leaves caller `HEAD`, index, and files unchanged.
8. A forecast approval pins exact inputs and result; staleness fails before
   mutation.
9. A complete forecast must reproduce its predicted tree before receipts.
10. Partial reconciliation receipts remain private until complete success.
11. Abort returns to the exact operation starting commit.
12. Pending operations and sessions are isolated per linked worktree.
13. Exact resolution reuse matches ordered blob identity and requires approval.
14. Ambiguous candidates do not auto-select.
15. Deterministic semantic merge blocks ambiguous same-entity outcomes.
16. Markdown remains canonical; a sidecar is sparse, derived, and consistent.
17. Old semantic IDs survive supported manifest migration.
18. Unchanged tracked spec indexing can take the zero-content-read path.
19. Persistent Git plumbing and ordinary Git produce identical domain results.
20. Session cache never treats mutable symbolic/index expressions as immutable.
21. Trace output never prints repository content or full commit messages.
22. A local receipt is not described as cryptographically trusted.
23. Unknown, malformed, dangling, or conflicting records cannot prove coverage
    or appear as reusable exact resolutions.
24. Metadata dry-run does not mutate destination refs, import does not silently
    overwrite conflicts, and a repeated import is a no-op.
25. Workspace/checkpoint and worktree-private state do not enter a portable
    metadata envelope.

If a proposed change intentionally breaks one, write a superseding ADR and
update the PRD before relying on the new behavior.

## 9. Known risks and unfinished areas

### Highest-value product gap

Rebase now has an accepted user model and first-class read-only causal plan,
but it does not yet have isolated forecasting, staleness/predicted-tree
guarantees, supervised application, recovery, or completed provenance.

### Other material gaps

- Rebase forecast/application/recovery and completed receipts are not yet
  implemented.
- Workspace archive/move/restore/prune and stale-path repair are incomplete.
- Forecasting does not include checkpoint or dirty-worktree overlays.
- There is no formal standalone schema catalog or schema negotiation.
- Current records are locally forgeable and unsigned.
- The historical proof label `signed-shaped-landing-receipt` overstates the
  current trust layer; it means signature-shaped, not signature-verified.
- Notes/resolution scans have not been characterized on genuinely large
  repositories.
- Crash/fault injection is not systematic at every Git-mutation/journal-write
  boundary.
- Semantic merge supports heading-oriented Markdown only.
- A persistent cross-command service is deliberately not implemented.

## 10. Delivered release track: v0.8 metadata integrity and portability

[ADR-0010](docs/adr/0010-add-a-validated-metadata-envelope-before-a-server.md)
is Accepted. It defines portable/local scope, root-commit lineage, exact schema
compatibility, read-only quarantine, deterministic envelope contents,
idempotent conflict semantics, and explicit trust non-claims.

The implemented commands are:

```text
vlab metadata status [--json]
vlab metadata validate [--strict] [--json]
vlab metadata export <directory> [--json]
vlab metadata import <directory> --dry-run [--json]
vlab metadata import <directory> --apply [--json]
```

The two-clone fixture contains hard-squash/reconciliation receipts, an exact
retained resolution, a v3 spec, a workspace/checkpoint/forecast exclusion case,
and invalid metadata. It verifies deterministic export, tamper and unrelated
lineage rejection, non-mutating conflict preview, atomic/idempotent import,
identical causal classifications, the same resolution blob and spec IDs, and
absence of source-local/private state at the destination.

The user independently repeated the Windows flow against a real clean
repository and disposable clones. Empty and non-empty exports were byte
deterministic; dry-run left refs unchanged; the first non-empty import changed
the causal plan from two new changes to two covered changes; the second import
was a no-op; and a tampered bundle failed with exit code 1 while refs and the
worktree remained unchanged.

### 10.1 Deliberate v0.8 limits

- no signing, actor identity, authorization, or server policy;
- no automatic push/fetch or remote capability negotiation;
- no override for unrelated or history-filtered lineage;
- no export of checkpoints, workspace registry paths, or active private state;
- no automatic repair of quarantined metadata;
- no native store, daemon, or background service.

### 10.2 Active v0.9 rebase track

[ADR-0011](docs/adr/0011-model-causal-rebase-as-a-forecasted-application-sequence.md)
is Accepted for the next core-product increment. It models causal rebase as a
non-interactive linear sequence of target-context applications, reuses the
coverage lattice and forecast guarantees, preserves same-intent IDs, requires
an explicit fork for changed intent, delays shared receipts until complete
success, and maps recovery to an exact worktree-private replay journal plus
ordinary Git cherry-pick state.

The first read-only `vlab rebase-plan <onto> [<source>]` slice is implemented.
It reuses exact coverage, marks actions as omit/review/replay, emits a stable
fingerprint, blocks linear-v1 merge topology, and is equality-tested across
ordinary and persistent Git modes without caller mutation. The next bounded
slice is isolated `rebase-forecast`; branch mutation remains out of scope until
that forecast contract passes. Workspace lifecycle/draft-overlay forecasting
and large-scale metadata benchmarks remain viable alternate tracks.

## 11. Test and release discipline

### During implementation

- Add one disposable-repository integration scenario per new invariant.
- Prefer read-only inspection before mutation features.
- Keep command output concise and add `--json` for complete records.
- Test Windows path and newline behavior; do not normalize bytes that are part
  of a hash/signature contract.
- Compare persistent-session and ordinary Git behavior.
- Use explicit full paths/IDs for destructive cleanup; never broad recursive
  deletion based on an unresolved variable.

### Before release

```powershell
npm test

$env:VLAB_GIT_SESSION = "1"
npm test
Remove-Item Env:VLAB_GIT_SESSION

npm run demo
npm run demo:conflict
npm run demo:resolution
npm run demo:forecast
npm run demo:spec
npm run demo:git-session

git status --short
git diff --check
```

Update together:

- `package.json` version;
- `src/version.js`;
- version integration test if it contains a literal;
- `CHANGELOG.md`;
- README release artifact examples;
- PRD current scorecard if capability status changed;
- architecture schemas/flows;
- ADR index/status;
- this handoff;
- annotated Git tag and portable release artifacts.

### Release artifact verification

For a Git bundle:

```powershell
git bundle verify .\causal-vcs-lab-X.Y.Z.bundle
git clone .\causal-vcs-lab-X.Y.Z.bundle $env:TEMP\vlab-bundle-check
Set-Location $env:TEMP\vlab-bundle-check
npm test
```

For a source ZIP, extract it to a fresh directory, initialize Git as documented
in README, and run version/test smoke checks. Record SHA-256 hashes outside the
tracked source tree to avoid circular release-content changes.

## 12. Practices for future sessions

- Lead with evidence from `git status`, current code, tests, and measured demos.
- Preserve unrelated or user-authored changes in a dirty worktree.
- Make small, reviewable edits and inspect the diff after each coherent group.
- Use Git-compatible operations and keep standard recovery visible.
- Never label a heuristic “safe” without defining evidence and approval.
- Never claim a local note is signed or authorized.
- Avoid introducing dependencies or services unless their value exceeds the
  maintenance, security, and portability cost.
- Update durable documents during the implementation, not as an afterthought.
- If the next task changes product intent, update PRD/ADR before code.
- If the task only diagnoses a problem, do not silently implement a broader
  fix.

## 13. Useful repository queries

```powershell
# Current commands and help contract
Select-String -Path src\cli.js -Pattern '^  vlab '

# Persisted schema identifiers
Get-ChildItem src -Filter *.js | Select-String -Pattern 'vcs-lab\.[a-z-]+/v[0-9]+'

# Integration scenarios
Select-String -Path test\integration.test.js -Pattern '^test\('

# Hidden ref/runtime assumptions
Get-ChildItem src -Filter *.js | Select-String -Pattern 'refs/vcs-lab|refs/notes|gitDir|commonDir'

# Latest release history
git log --oneline --decorate --max-count=20
```

On POSIX shells, use `rg` equivalents; `rg` is the preferred repository search
tool when available.

## 14. Copy/paste prompt for a new AI session

```text
Continue development of the vcs-lab repository at
C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab.

First read SESSION_HANDOFF.md, PRD.md, ARCHITECTURE.md, and
docs/adr/README.md. Inspect git status and preserve any existing changes. Verify
the current version/tag and run the relevant baseline tests before editing.

The v0.8 metadata integrity and portability work is implemented and ADR-0010 is
Accepted. ADR-0011 is also Accepted for first-class causal rebase under the
linear-v1 model. Its read-only `rebase-plan` slice is implemented as described
in section 10.2. Verify plan determinism/non-mutation and preserve its
omit/review/replay, unexpected-empty, identity, tree-pinning, and recovery
invariants while implementing the next isolated `rebase-forecast` slice.
Preserve all invariants listed in section 8.

Implement the agreed increment, add disposable-repository integration tests,
run the suite with the persistent Git session both disabled and enabled, update
all durable docs and changelog, and produce independently verified release
artifacts. Do not add a server, daemon, signing system, native object store, or
unrelated-lineage import override unless I explicitly expand the scope.
```

## 15. Handoff completion checklist

A future session is genuinely picked up when it can answer all of these from
the repository, not from chat memory:

- What problem is the product solving and why is Git retained?
- Which identity proves exact state versus logical continuity?
- Why does a hard squash not make its source commits Git ancestors?
- What evidence may silently mark a change covered?
- Which operation state is worktree-private versus repository-shared?
- What exactly does a forecast pin and when are receipts published?
- Why can an exact resolution be reused across a rename but not changed input?
- Why is Markdown canonical and what does the sparse sidecar retain?
- What can the persistent Git session cache safely?
- Which metadata scopes enter an envelope, how is clone/fork lineage decided,
  and why can an invalid record not prove coverage?
- Why does envelope integrity not establish actor trust or authorization?
- What has passed on the release host versus been independently observed on
  the user's Windows machine?
- What is the next proposed scope, and which parts are deliberately excluded?

If any answer is unclear, correct the durable docs before starting a broad new
implementation.
