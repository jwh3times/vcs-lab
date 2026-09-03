# Continuation brief

## Document status

| Field | Value |
| --- | --- |
| Baseline | v0.13.2 released |
| Status | Maintained until every item below is closed, then deleted |
| Written | 2026-09-02, from a full evaluation of the repository at v0.13.1 |
| Updated | 2026-09-03, after the brief's work landed; again the same day when items 4, 6, and 7 closed in a working tree (changelog, Unreleased) |

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

1. **The POSIX default suite was red at v0.13.1.** Fixed and released in
   v0.13.2 (below).
2. **`vlab reconcile --abort` reset whichever branch was checked out.** Fixed
   and released in v0.13.2.
3. **No continuous integration existed.** Added in v0.13.2.
4. **Gate A item 3 has no candidate.** Decided by
   [ADR-0024](adr/0024-close-the-native-read-engine-program-at-phase-0b.md),
   Proposed; see [item 1](#1-make-the-synced-onedrive-measurement-then-accept-or-amend-adr-0024).
5. **Documentation drift.** Reconciled; see
   [what landed on 2026-09-03](#landed-on-main-on-2026-09-03).
6. **Smaller defects and test gaps.** All closed; the last, `appendNote`'s
   compare-and-swap, closed on 2026-09-03 as a lock (changelog, Unreleased),
   together with the Change-Id resolver's determinism and the suites' shared
   Git environment, which the brief had listed as items 6 and 7.

## What is done

### Released in v0.13.2

All four commits are on `main`. The CI run for `ef6f224` passed all fifteen
jobs.

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

### Landed on `main` on 2026-09-03

The rest of the brief's work was done on 2026-09-02 and landed on `main` on
2026-09-03 as three commits: the source defects with their tests, the suite
gaps, and the reconciliation with ADR-0024 and the changelog. The
`Unreleased` section of the [changelog](../CHANGELOG.md) describes every
change; in summary:

- **Documentation reconciliation**, the whole of the evaluation's list:
  roadmap, product requirements, architecture reference, README, testing
  guide, and the schema catalog README.
- **Source defects**: `vlab verify-proof` shape validation and the
  `proofBundleBytes` bound; `vlab doctor` no longer initializes; the
  `conflict-blocked`, `already-exists`, and new `stale-manifest` codes; the
  pending cherry-pick read through the engine seam as the cataloged operation
  `pseudoRefTarget` (39 operations now); one resolution-catalog scan per
  conflict capture with existence checks through `inspectGitObjects`; the
  two-argument `recordsReachableFrom`; honest `--json` help text. Each has a
  regression test.
- **Test-suite gaps**, all six: global and system Git config isolated in every
  suite file; the version pin derived from `src/version.js` and checked
  against `package.json`; the forced-session mode self-checking; behavior
  tests for `vlab merge` mode selection, `cherry-pick --repeat`, `resolve
  reject`, `workspace create --owner`/`--focus`, and `spec index --force`;
  anchor checking in `scripts/check-doc-links.mjs`; module-scope cleanup in
  `test/schema-catalog.test.js`.
- **ADR-0024** (Proposed) and the roadmap and product edits that follow from
  it.

Before landing, every documented suite mode
([testing.md](testing.md#development-validation)) passed on the Windows
host, along with `npm run test:docs`, `npm run sync:agents -- --check`, and
`git diff --check`. The benchmark check and the demos were not run: the host
was under load, and the `win32` entry needs re-recording regardless
([item 2](#2-re-record-the-win32-baseline)).

## Remaining items

### 1. Make the synced-OneDrive measurement, then accept or amend ADR-0024

[ADR-0024](adr/0024-close-the-native-read-engine-program-at-phase-0b.md)
closes ADR-0015 phases 1 through 4 on the committed baseline and names a
synced-OneDrive measurement as its first reopening condition. No run has ever
placed a repository in a synced folder, and the attempt on 2026-09-02 was not
made: the OneDrive client was not running on the host and the machine was
under load, and a measurement under either condition would say nothing.

How to make it, on a quiet Windows host with the OneDrive client running
(`Get-Process OneDrive` must list it):

1. Create a disposable folder inside the synced tree (for example
   `%OneDrive%\vlab-probe`) and point `TEMP` and `TMP` at it for the shell,
   so `temporaryDirectory` in `src/store.js` builds every fixture there.
2. Run `npm run test:benchmark`. The check compares each phase with the
   committed `win32` entry, which was recorded under the unsynced temporary
   directory, so its per-phase ratios are the result.
3. Optionally clone this repository into the same folder and time `vlab
   workspace create`, `vlab metadata status`, and `vlab merge-plan` against
   the same commands on a clone under the ordinary temporary directory.
4. Post the figures on [issue #14](https://github.com/jwh3times/vcs-lab/issues/14),
   which keeps "OneDrive path edges" as its one open item, then delete the
   probe folder: it syncs to the cloud while it exists.

If a Git-best-mode phase exceeds 1,000 ms, the ADR's first reopening condition
is met: write the phase 1 ADR naming that budget and mark ADR-0024 superseded.
Otherwise accept ADR-0024 (status and index row) and close the OneDrive item
on #14 with the evidence. Either way the roadmap stops saying "Proposed".

### 2. Re-record the `win32` baseline

The `win32` entry of `benchmarks/baseline.json` still records 41 publication
processes and reports a one-process regression until `npm run
benchmark:record` is run on the Windows host; the `linux` entry was
re-recorded to 57 in v0.13.2 for the same reason (the abort guard's one
`symbolic-ref` read per reconciliation). Run it on a quiet host, nothing else
running, and run `npm run test:benchmark` first: the expected findings are
that one publication process and possibly *fewer* processes in the forecast
modes, if the fixture's conflicted steps exercised the per-path catalog scan
this tree removes. No phase should grow; if one does, find out why before
recording.

### 3. Start the branch-and-land workflow

[ADR-0023](adr/0023-locate-the-model-substrate-mismatch-in-facts-not-content.md)'s
amendment records that this repository never rewrites history, so provenance
is only ever declared and never carried, and Gate B condition 9 (real
agent-workload evidence) cannot come from it. The prerequisite is a
branch-and-land workflow, here or on another real repository.

The cheapest form: land the next few increments on this repository through
`vlab branch`, `vlab commit --generated-by`, and `vlab merge --compact`,
instead of committing directly to `main` as the 2026-09-03 increments still
did. That produces carried provenance, compact-landing receipts, and the
first dogfooding telemetry, and it gives
[issue #17](https://github.com/jwh3times/vcs-lab/issues/17) (receipt metrics
exclude publication) real data to decide on. Retain telemetry per
[product.md](product.md) section 15; never commit raw runs. This is the
owner's decision: it requires `vlab init` against the real checkout, which
the rules below otherwise forbid.

### 4. Structural suggestion from the evaluation

Not started, and a maintainer's call: the roadmap, changelog, and ADR
amendments each narrate the same events, so every release has to be rewritten
in three or four places and was not. Prefer moving dated progress out of the
roadmap into issues, and consider generating the architecture document's
schema and module tables from `src/schemas.js` and the source tree so the
test that keeps them honest is mechanical.

## Rules for whoever continues

- Run `vlab` and history-changing Git only in disposable repositories under
  the OS temporary directory, never in this checkout.
- Do not commit or push unless asked; the owner commits directly to `main`
  and requests release actions explicitly.
- After a push, read the CI run before claiming a gate passed. Windows suite
  jobs take 8 to 11 minutes; Ubuntu jobs 2 to 3.
- Benchmarks and baseline records need a quiet host: nothing else running,
  including other agents' suites. Wall-clock figures taken under load end up
  in ADRs and the committed baseline.
- When an item above closes, delete it here.
