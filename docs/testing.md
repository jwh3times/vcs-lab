# Testing and qualification

This document defines the maintained validation contract. Tests create
disposable repositories and exercise the real CLI and Git executable; do not
run history-changing manual experiments in a valuable repository.

## Requirements

- Node.js 20 or newer
- Git 2.40 or newer (Git 2.49 or newer to exercise the merge-tree forecast
  engine; the merge-tree scenarios skip on older Git, where one scenario
  verifies the immediate `git-too-old` fallback instead)
- a clean source checkout for release qualification
- enough system temporary space for disposable repositories

The package has no runtime dependencies and no build step.

## Development validation

Run the complete integration suite in ordinary mode:

```bash
npm test
```

Run it again with the invocation-scoped Git object session forced:

```powershell
$env:VLAB_GIT_SESSION = "1"
npm test
Remove-Item Env:VLAB_GIT_SESSION -ErrorAction SilentlyContinue
```

On POSIX shells:

```bash
VLAB_GIT_SESSION=1 npm test
```

Run it with each forecast engine forced. The default engine differs by
platform (`merge-tree` on Windows, `worktree` elsewhere), so both runs are
needed on every host: the merge-tree run simulates every clean forecast step
through `git merge-tree` and falls back to the worktree simulator where it
must, and the worktree run exercises the oracle throughout:

```powershell
$env:VLAB_FORECAST_ENGINE = "merge-tree"
npm test
$env:VLAB_FORECAST_ENGINE = "worktree"
npm test
Remove-Item Env:VLAB_FORECAST_ENGINE -ErrorAction SilentlyContinue
```

```bash
VLAB_FORECAST_ENGINE=merge-tree npm test
VLAB_FORECAST_ENGINE=worktree npm test
```

Run it with the native read engine selected. No native binding exists yet,
so every read operation passes through to Git and is recorded as a fallback;
what the run proves is that every read the suite exercises goes through the
engine seam (`src/engine.js`), because a read that bypasses the seam is
refused in this mode (ADR-0019):

```powershell
$env:VLAB_ENGINE = "native"
npm test
Remove-Item Env:VLAB_ENGINE -ErrorAction SilentlyContinue
```

```bash
VLAB_ENGINE=native npm test
```

Run the maintained demonstrations when changing their workflows:

```bash
npm run demo
npm run demo:conflict
npm run demo:resolution
npm run demo:forecast
npm run demo:spec
npm run demo:git-session
```

Use targeted Node test-name patterns during development, but complete the
ordinary, forced-session, both forced-forecast-engine, and native-engine runs
before treating a cross-cutting, forecast, or read-path change as qualified.
`npm run demo:git-session` additionally compares the three forecast modes on
one queue, and `vlab doctor --differential` compares the read engines
operation by operation in any repository.

## Benchmark regression check

`npm run test:benchmark` builds a reduced scale fixture and a 12-change
forecast fixture in disposable repositories and compares their Git process
counts and medians against this host's entry in `benchmarks/baseline.json`
(ADR-0017). A process count above the baseline, a median above twice the
baseline (or the baseline plus 5 ms, whichever is larger), or a forecast whose
modes disagree fails the check; a host without an entry is skipped with a
warning, and a forecast mode the host cannot run (merge-tree below Git 2.49)
is reported as skipped. The entry's `recordedAt`, `git`, and `node` fields
are the provenance the check prints, not a result report: the baseline is the
one committed host-specific measurement, permitted because this check
consumes it. An interrupted run removes its `vcs-lab-benchmark-check-*`
fixtures on SIGINT. Record or refresh this host's entry deliberately, on a
quiet host in a clean checkout, and commit it with the change that moved the
numbers:

```bash
npm run benchmark:record
```

## Static checks

Before merging a documentation or source change:

```bash
git diff --check
npm run test:docs
npm run sync:agents -- --check
node --check src/cli.js
node --test
```

For broad JavaScript changes, run `node --check` over every tracked JavaScript
file under `src`, `bin`, `scripts`, and `test`. `npm run test:docs` verifies
local Markdown link targets. New or changed formal requirement IDs must remain
unique and every reference must resolve to a definition.

## Release gate

A release candidate is eligible only when:

1. the source checkout begins and ends clean at the same candidate commit;
2. the integration suite passes in ordinary, forced-session, both forced
   forecast-engine, and native read-engine modes;
3. all maintained demos complete;
4. metadata validation reports no unexpected errors;
5. expected-failure cases leave protected refs and worktrees unchanged;
6. no VCS Lab Node or Git process remains after completion;
7. version constants, package metadata, changelog, and release tag agree; and
8. the packed artifact passes an install and smoke test outside the source
   checkout; and
9. `npm run test:benchmark` passes on every host that has an entry in
   `benchmarks/baseline.json`; hosts without an entry are reported as
   skipped.

New schemas, migration behavior, replay algorithms, or performance decisions
require focused disposable-repository coverage in addition to this general
gate. Release qualification does not establish production readiness, security
review, service-level objectives, or broad platform performance.

## Evidence retention

Record the tested commit, platform and tool versions, command outcome, and any
material exception in the pull request or release summary. Store raw logs and
generated repositories as CI artifacts with an explicit retention period; do
not commit timestamped result reports or machine-local temporary paths.

If a failure produces a lasting design constraint, add or supersede an ADR. If
it produces a product correction, add a regression test and changelog entry.
Git history remains the record of prior one-off qualification documents.
