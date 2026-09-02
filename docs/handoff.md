# Continuation brief

## Document status

| Field | Value |
| --- | --- |
| Baseline | v0.13.2 released |
| Status | Maintained until every item below is closed, then deleted |
| Written | 2026-09-02, from a full evaluation of the repository at v0.13.1 |

This brief exists so the work started on 2026-09-02 can be picked up in a
later session without re-deriving it. It is deliberately independent of any
workstation or temporary path. When an item closes, remove it here and record
the outcome where it belongs: the [changelog](../CHANGELOG.md) for behavior,
an [ADR](adr/README.md) for a decision, the [roadmap](roadmap.md) for
sequencing. The repository policy in [docs/README.md](README.md) puts active
briefs in issues; this file is the owner's exception to that rule and should
not outlive the work it describes.

## What the evaluation found

The repository was evaluated on a Linux host (Git 2.55, Node 24) with every
suite mode run, three independent reviews (source, tests, documentation), and
the two most severe findings reproduced in disposable repositories.

1. **The POSIX default suite was red at v0.13.1.** Two tests failed in every
   session-off mode. A missing revision was classified `revision-not-resolved`
   through the Git object session and `git-command-failed` through the
   one-process fallback. The session is the default on Windows only, so the
   Windows-hosted release gate never saw it. The POSIX evidence on
   [issue #14](https://github.com/jwh3times/vcs-lab/issues/14) predates the
   envelope commit.
2. **`vlab reconcile --abort` reset whichever branch was checked out.** The
   journal never recorded its branch, and abort hard-resets HEAD to
   `targetBefore`. The rebase path had a guard from the start; the
   reconciliation path did not.
3. **No continuous integration existed.** The five-mode gate ran by hand on
   one host, and "ordinary mode" on a Windows host is not ordinary mode on a
   POSIX host.
4. **Gate A item 3 has no candidate.** In Git's best mode every phase of the
   committed `win32` baseline is under the 1,000 ms interactive budget. See
   [Step 3](#step-3-decide-adr-0015-phase-1-on-the-evidence).
5. **Documentation drift.** The roadmap, product requirements, and
   architecture document contradict each other and the changelog. See
   [Step 5](#step-5-reconcile-the-documents).
6. A list of smaller defects and test gaps. See
   [Step 6](#step-6-clear-the-smaller-defects-and-coverage-gaps).

## What is done

All four commits are on `main` and released in v0.13.2. The CI run for `ef6f224`
passed all fifteen jobs.

| Commit | Change |
| --- | --- |
| `6514011` | Reconcile continue/abort refuse a worktree on another branch (`targetBranchRef` in the v4 journal, optional; `recovery` block in `reconcile --status`). Five process-path resolvers in `src/git.js` classify a missing revision as the session path does. |
| `bd4d21f` | `.github/workflows/ci.yml`: static checks plus one job per suite mode per platform. `VLAB_GIT_SESSION=0` joins the documented matrix. Release-gate item 3 names both session settings and both platforms. |
| `7e83c30` | The CLI canonicalizes its working directory at entry (`canonicalizeWorkingDirectory` in `src/cli.js`). The GitHub Windows runner's temporary directory is an 8.3 alias that Git reports in long form; 26 tests failed there. |
| `ef6f224` | Every temporary directory the source creates comes from `temporaryDirectory` in `src/store.js`, which returns the canonical path. This closed the eight failures inside forecast worktrees and benchmark corpora. |

Two properties of the workflow to keep in mind:

- Each suite job requires **exactly one** self-skipped test (the too-old-Git
  case). A new test that skips on one platform must adjust that rule in the
  workflow rather than silently reducing what a job proves.
- The benchmark is not in CI because its baseline is per-host. Demos,
  metadata validation, and the packed-install smoke test remain release-time
  steps in [testing.md](testing.md#release-gate).
- The v0.13.2 gate re-recorded the `linux` publication process count (57:
  the abort guard's one `symbolic-ref` read per reconciliation). The `win32`
  baseline entry still says 41 and will report a one-process regression
  until `npm run benchmark:record` is run on the Windows host.

These four commits shipped in **v0.13.2**. Its release gate was the one in
[testing.md](testing.md#release-gate), with item 3 satisfied by the CI run
on the release commit.

## Step 3: decide ADR-0015 phase 1 on the evidence

[ADR-0015](adr/0015-adopt-a-phased-native-core-program-with-rust.md) says
phase 0b ends in one of two ways: a phase 1 ADR names the Gate A item 3
budget from the phase 0a runs, or the program stops with a complete outcome.
[ADR-0014](adr/0014-split-the-native-implementation-gate-into-engine-and-store-gates.md)
item 3 needs "a named per-command budget on a representative Windows or
OneDrive host that the batched Git path measurably misses".

The committed `benchmarks/baseline.json` `win32` entry, in Git's best mode:

| Phase | Median |
| --- | --- |
| `workspaceCreate` | 403 ms |
| `metadataStatus` | 398 ms (p95 536 ms) |
| forecast, merge-tree session | 428 ms |
| `workspaceCreateCone` | 225 ms |
| `resolutionCatalog` | 181 ms |
| budget | 1,000 ms |

Nothing misses. The only figure over budget is the worktree forecast without
a session (2,203 ms), and that is not Git's best mode; the merge-tree session
is the Windows default. On this evidence the honest ADR closes the native
read-engine program with a complete outcome, keeping the seam, the schemas,
and the baseline.

What could change that, and should be tried first: a measurement on a real
repository inside a synced OneDrive folder on the Windows host. Issue #14
still lists OneDrive path edges as its one open item, and no run so far has
placed a repository in a synced folder. If that run produces a miss, the ADR
names that budget and phase 1 opens under the ADR-0014 sunset. Either way,
write the ADR; the roadmap currently says "the phase 1 ADR ... is the next
decision" in three places and the decision should stop being implicit.

## Step 4: start the branch-and-land workflow

[ADR-0023](adr/0023-locate-the-model-substrate-mismatch-in-facts-not-content.md)'s
amendment records that this repository never rewrites history, so provenance
is only ever declared and never carried, and Gate B condition 9 (real
agent-workload evidence) cannot come from it. The prerequisite is a
branch-and-land workflow, here or on another real repository.

The cheapest form: land the next few increments on this repository through
`vlab branch`, `vlab commit --generated-by`, and `vlab merge --compact`,
instead of committing directly to `main`. That produces carried provenance,
compact-landing receipts, and the first dogfooding telemetry, and it gives
[issue #17](https://github.com/jwh3times/vcs-lab/issues/17) (receipt metrics
exclude publication) real data to decide on. Retain telemetry per
[product.md](product.md) section 15; never commit raw runs.

## Step 5: reconcile the documents

Verified contradictions, most consequential first. Each is a small edit.

- `docs/roadmap.md` calls v0.11 and v0.12 work "implemented, unreleased" in
  five places (the engine seam, schema catalog, canonical-JSON profile,
  compatibility contract, conformance fixtures, and commit-level provenance)
  while its own opening paragraph says they were released. The document's
  vocabulary reserves "unreleased" for items still under `Unreleased`.
- The roadmap's requirement backlog marks FR-ID-06, FR-ID-07, and FR-PLAN-08
  as "Planned"; the same document says they were done on 2026-08-31 and
  `product.md` marks them implemented. Horizon 5 phase 2 still scopes the
  identity audit and proof bundle as future native work.
- Horizon 5's phase 0b row says the catalog and canonical-JSON profile "are
  open"; `product.md` section 15 says "the catalog is open". Both shipped.
- The status headers of `roadmap.md`, `product.md`, and `architecture.md`
  carry a stale baseline and review date.
- `docs/architecture.md` says JSON schemas are "not yet published", that the
  catalog and profile "are next", that `VLAB_ENGINE=native` is "the suite's
  third mode", and that crash consistency has no fault-injection coverage.
  Its schema table omits `error/v1`, `identity-audit/v1`, `proof-bundle/v1`,
  `proof-verification/v1`, and `provenance/v1`; its module table omits
  `canonical-json.js`, `faults.js`, `identity-audit.js`, `proof-bundle.js`,
  and `provenance.js`. ADR-0021 through ADR-0023 are not referenced.
- `README.md` does not document `vlab audit identity`, `vlab proof-bundle`,
  `vlab verify-proof`, `vlab compact-merge`, `vlab hard-squash`, or the
  `--cone`, `--owner`, `--authored-by`, `--all`, `--allow-empty`, `--repeat`,
  `--offline`, and `spec index --force` flags. It says "the supported v0.8
  transfer path" and cites "Version 0.3-0.7" in six places.
- Help text advertises `--json` for `workspace list`, `spec show`, and
  `spec benchmark`, whose handlers always print JSON, and omits it for
  `workspace create`, which honours it.
- Four environment variables are undocumented everywhere:
  `VLAB_GIT_SESSION_DIAGNOSTICS`, `VLAB_GIT_SESSION_DIAGNOSTICS_FILE`,
  `VLAB_TEST_GIT_SESSION_FAILURE`, `VLAB_TEST_MERGE_TREE_SESSION_FAILURE`.
- Open product question 3 (Change-ID scope) is answered by the frozen
  `vcs-lab.logical-id/v1` protocol but still listed as open.
- Issue #17 is mentioned in no document.

The structural judgment behind the drift: the roadmap, changelog, and ADR
amendments each narrate the same events, so every release must be rewritten
in three or four places and was not. Prefer moving dated progress out of the
roadmap into issues, and consider generating the architecture document's
schema and module tables from `src/schemas.js` and the source tree.

## Step 6: clear the smaller defects and coverage gaps

Confirmed by reading or reproduced in a scratch repository, in priority order.

- `vlab verify-proof` leaks a raw `TypeError` (`receipts.flatMap is not a
  function`) on a bundle whose `evidence.receipts` is not an array
  (`src/proof-bundle.js`), and reads the file with no size bound
  (`src/cli.js`). Add it to `test/hostile-input.test.js`.
- `vlab doctor` calls `initLab()` and writes `notes.displayRef` and
  `notes.rewriteRef`. A diagnostic should not mutate configuration.
- `src/landings.js` throws a bare `Error` with `details`, so the `--json`
  envelope reports `code: null`. The static scan in
  `test/error-envelope.test.js` only sees `new CliError`.
- Code misclassifications: `src/workspaces.js` raises `not-found` for
  "already exists" in four places, and `src/specs.js` raises
  `stale-forecast` for a stale manifest in three.
- `recordsReachableFrom` in `src/notes.js` shadows the imported
  `reachableCommits` with its own parameter, so its documented two-argument
  form throws. The one caller passes three arguments.
- The resolution catalog is rebuilt, with full blob contents, for every
  conflicted path (`captureConflictDescriptors` in `src/resolutions.js`);
  existence checks could use `inspectGitObjects` and the catalog could be
  cached per operation.
- Two facts are read from the filesystem rather than through the engine seam
  (`cherryPickHead` and `mergeMessagePath` in `src/reconcile-state.js`),
  while `src/rebase-operations.js` answers the same question through
  `revisionResolves("CHERRY_PICK_HEAD")`. A native engine would see only one.
- Not reproduced: `appendNote` in `src/notes.js` is read-then-write with no
  compare-and-swap on `refs/notes/vcs-lab`, so two concurrent publishers can
  drop a record.

Test-suite gaps from the review:

- Tests inherit the host's global Git config. Set `GIT_CONFIG_GLOBAL` and
  `GIT_CONFIG_NOSYSTEM` in the shared `exec` helpers (and consider the same
  in `src/git.js`) so a `commit.gpgsign` or `core.hooksPath` setting cannot
  break the suite.
- No test reaches `vlab merge` mode selection, `cherry-pick --repeat`,
  `resolve reject`, `workspace create --owner`, `--focus`, or
  `spec index --force`.
- The forced-session mode never asserts that a session was used; one
  assertion on the trace or `timings.git` under `VLAB_GIT_SESSION=1` would
  make the mode self-checking.
- The version pin in `test/integration.test.js` is a hand-edited literal;
  nothing asserts `src/version.js` agrees with `package.json`.
- `scripts/check-doc-links.mjs` does not check anchors.
- `test/schema-catalog.test.js` registers its fixture cleanup inside the
  first test that builds the shared fixture; `test/conformance.test.js`
  documents why that pattern is wrong.

## Rules for whoever continues

- Run `vlab` and history-changing Git only in disposable repositories under
  the OS temporary directory, never in this checkout.
- Do not commit or push unless asked; the owner commits directly to `main`
  and requests release actions explicitly.
- After a push, read the CI run before claiming a gate passed. Windows suite
  jobs take 8 to 11 minutes; Ubuntu jobs 2 to 3.
- When an item above closes, delete it here.
