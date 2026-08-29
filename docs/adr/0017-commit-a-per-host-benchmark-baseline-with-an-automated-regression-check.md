# ADR-0017: Commit a per-host benchmark baseline with an automated regression check

- **Status:** Accepted
- **Date:** 2026-08-29
- **Owners:** Repository maintainers
- **Related requirements:** FR-PERF-01, FR-PERF-02, FR-PERF-10, NFR-PERF-03,
  NFR-PERF-06, NFR-TEST-01

## Context

NFR-PERF-06, added by
[ADR-0014](0014-split-the-native-implementation-gate-into-engine-and-store-gates.md),
says that per-invocation latency budgets are measured per host by the
benchmark suite and that, once a baseline is committed with the automated
regression check that consumes it, a regression blocks a release.
`docs/testing.md` release gate item 9 references that check, and
`docs/README.md` permits committing a machine-readable baseline only when an
automated check consumes it. Neither the baseline nor the check existed, so
the gate item was vacuous by design
([GitHub issue #5](https://github.com/jwh3times/vcs-lab/issues/5)).

Two evidence sources exist. `vcs-lab.repository-scale-benchmark/v1`
(ADR-0013) measures repository scans on a disposable fixture and reports
medians, p95, and Git process counts per phase; its representative profile
takes about 40 s of fixture setup on the Windows host, which is too slow for a
check that runs in every qualification. Forecast metrics report process
launches, logical queries, and elapsed time per forecast, and
[ADR-0016](0016-simulate-clean-forecast-steps-with-a-merge-tree-session.md)
now makes the engine and session mode part of what a number means.

Process counts on a fixed fixture are deterministic. Wall time on the
maintainer's Windows/OneDrive development host is not: the same phase varies
by tens of percent between runs with antivirus, sync, and cache effects.

## Decision

### Baseline shape

`benchmarks/baseline.json` carries schema `vcs-lab.benchmark-baseline/v1`:

- `profile`: the fixed reduced volume the check runs (`reduced-local-v1`:
  100 commits, 4 workspaces, 60 notes, 12 resolutions, 3 samples, the
  1,000 ms budget, and a 12-change forecast queue);
- `tolerance`: the documented limits (below);
- `hosts.<platform>`: one entry per `process.platform` (`win32`, `linux`,
  `darwin`) with the recording date, Git and Node versions, per-phase
  `medianMs`, `p95Ms`, and `medianProcesses` for the seven scale phases, and
  per-mode forecast `processes`, `queries`, and `forecastMs` for
  `worktree-ordinary`, `worktree-session`, and `merge-tree-session`.

Git and Node versions are recorded for interpretation, not as part of the
key: a toolchain upgrade that moves a number is a deliberate re-record, not a
silent new baseline.

### Check

`npm run test:benchmark` (`scripts/benchmark-regression.mjs`) builds the
reduced scale fixture and the forecast fixture in disposable repositories,
measures them, and compares against this host's entry:

- a phase or forecast mode whose median process count exceeds the baseline
  fails (tolerance 0; process launches are the deterministic guard);
- a median or forecast time above twice the baseline, or above the baseline
  plus 5 ms for phases too fast for a ratio to be meaningful, fails (ratio
  2.0 with a 5 ms floor; this is a coarse guard against order-of-magnitude
  regressions, not a wall-time contract);
- forecasts in the three modes must produce identical plans, per-step trees,
  and predicted trees, and the merge-tree mode must not fall back on the
  clean queue; a difference fails as a correctness regression;
- a forecast mode the host cannot run (the merge-tree mode below Git 2.45) is
  measured on neither side and reported as skipped, never as a regression;
- a host with no baseline entry skips with a warning and exit 0, so a new
  host is never blocked by evidence it cannot yet have;
- a baseline recorded with a different profile or tolerance is an error that
  asks for a re-record; the tolerance is committed in the file so the limits
  applied are the limits recorded.

`npm run benchmark:record` rewrites this host's entry from a fresh run. It is
run on a quiet host, in a clean checkout, and committed together with the
change that moved the numbers, with the reason in the changelog. When the
profile or tolerance has changed since the file was recorded, recording drops
the other hosts' entries, which are no longer comparable, and says so; each
host re-records its own. An interrupted run removes its
`vcs-lab-benchmark-check-*` fixtures.

### Gate

Release gate item 9 becomes active on every host that has an entry: the
check must pass there before a release. Hosts without an entry are reported
as skipped in the release summary.

## Constraints

- The check consumes the committed baseline; nothing else may read it, and
  no timestamped run output is committed.
- The reduced profile is fixed by the script; changing it changes the schema
  or forces every host to re-record.
- Representative evidence for decisions still comes from the representative
  profile and is recorded in ADRs (ADR-0013, ADR-0016); the reduced profile
  guards regressions only.
- A regression is fixed or the baseline is re-recorded deliberately; the
  tolerance is never widened to make a run pass.

## Consequences

### Positive

- Process-count regressions in scans and forecasts block a release
  automatically on the hosts that qualify releases.
- Engine and session mode are part of every recorded forecast number.
- The check runs in well under a minute on the development host.

### Negative

- The latency guard is coarse; a 50% slowdown passes.
- Each qualifying host must record and maintain its own entry, and a
  toolchain upgrade may require a re-record.
- The reduced profile is below ADR-0013's ten-entity threshold for
  amplification decisions, so it never informs those decisions.

## Rejected alternatives

- **Compare against the representative profile:** the 40 s setup makes the
  check too slow to run in every qualification.
- **Wall time only:** contradicts NFR-PERF-03; process counts and semantic
  equality are the acceptance signals.
- **Key baselines by CPU or machine name:** would create one entry per
  workstation and no shared expectation per platform.
- **Fail on hosts without a baseline:** would block contributors on
  platforms the maintainer has not measured.

## Implementation map

- Check and recorder: `scripts/benchmark-regression.mjs`, `package.json`
  (`test:benchmark`, `benchmark:record`)
- Committed baseline: `benchmarks/baseline.json`
- Gate wording and command: `docs/testing.md`
- Evidence policy: `docs/README.md`, `docs/product.md` NFR-PERF-06
- Implementation brief: [GitHub issue #5](https://github.com/jwh3times/vcs-lab/issues/5)
