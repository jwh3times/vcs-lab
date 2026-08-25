# ADR-0013: Measure scan amplification before adding indexes or a service

- **Status:** Accepted
- **Date:** 2026-08-24
- **Owners:** Repository maintainers
- **Related requirements:** FR-WS-09, FR-SPEC-12, FR-PERF-03, FR-PERF-07, FR-PERF-09, FR-PERF-10, NFR-PERF-03 through NFR-PERF-05, NFR-SEC-02

## Context

The laboratory has bounded functional contracts for causal metadata,
resolutions, specifications, linked-worktree workspaces, and invocation-scoped
Git object sessions. It did not have one repeatable fixture that varied history,
worktree, note, and resolution volume together. Without that evidence, adding a
persisted catalog or resident repository service would confuse three different
costs:

- reading already-compact local registry data;
- launching one or more Git processes per entity; and
- scanning an already-batched object namespace whose latency grows with data.

The existing `vcs-lab.spec-benchmark/v2` already covers documentation volume,
content reads, cache hits, and metadata size. The missing experiment is the
repository and shared-metadata side of FR-PERF-10.

## Decision

Add `vlab metadata benchmark` and schema
`vcs-lab.repository-scale-benchmark/v1`. The command creates a disposable Git
repository, measures it, and removes it without reading or changing the caller
repository.

### Fixture

The representative-local v1 profile contains:

- 250 commits of reachable linear history;
- 12 active linked-worktree workspaces plus the main worktree;
- 250 valid causal note records on distinct commit targets;
- 50 valid retained resolution records and refs; and
- three measurement samples.

The caller can override `--history`, `--workspaces`, `--notes`, `--resolutions`,
`--samples`, and `--budget-ms` within explicit bounds. Generated identities and
content are synthetic. Setup duration and Git metrics are reported separately
from scan measurements.

### Measurements

Every phase verifies the same semantic result across samples and records cold,
warm-median, median, and p95 latency plus logical queries, Git processes,
session queries, cache hits, failures, and per-command totals. The phases are:

- reachable history count;
- stock Git worktree discovery;
- workspace registry JSON read;
- complete workspace status inspection;
- batched causal note catalog;
- reusable resolution catalog; and
- complete validated metadata status.

The JSON never includes fixture paths, object IDs, file contents, or commit
messages. Documentation volume remains covered by the companion
`vcs-lab.spec-benchmark/v2` schema rather than duplicating that corpus.

### Decision policy

The default interactive budget is 1,000 ms and may be overridden. A phase that
launches more than one Git process per measured entity is a batching candidate
before it is an indexing candidate. An already-batched phase that still exceeds
the budget at representative volume becomes an incremental-catalog candidate.

A resident service is never recommended from one local synthetic run. It may
be reconsidered only after invocation-local batching and any justified
incremental catalogs are measured on representative Windows and non-Windows
repositories and cross-command cost remains material.

## Initial evidence

The representative profile from clean commit
`fd8ade038995df36c98f992e051c8a4cf5d93065` on the 2026-08-24 Windows
development host produced:

| Phase | Median | Git processes | Interpretation |
| --- | ---: | ---: | --- |
| History, 250 commits | 72.74 ms | 1 | Bounded streaming scan |
| Git worktree list, 13 worktrees | 59.29 ms | 1 | Bounded stock Git scan |
| Registry read, 12 workspaces | 0.31 ms | 0 | No registry index indicated |
| Workspace status, 12 workspaces | 1,597.78 ms | 36 | Three processes per workspace; batch first |
| Note catalog, 300 targets | 172.67 ms | 2 | Existing batch path is effective |
| Resolution catalog, 50 records | 5,503.66 ms | 103 | Per-ref traversal dominates; batch first |
| Complete metadata status | 780.25 ms | 11 | Within the default median budget |

The evidence selects one bounded next optimization: batch workspace status and
resolution catalog scans, then rerun the same schema. It does not justify a new
persisted index or resident service.

## Constraints

- The benchmark must not mutate or disclose data from the caller repository.
- Fixture setup cost cannot be presented as scan cost.
- Timing claims name the host/profile and remain non-production evidence.
- Process count and semantic equality remain acceptance signals alongside wall
  time.
- The benchmark does not retain its disposable repository.
- Schema changes that alter fixture shape or measurement meaning require a new
  schema version.

## Consequences

### Positive

- Performance work now has one trendable repository-scale JSON contract.
- Cheap registry reads are distinguished from expensive status probes.
- Batched note behavior is visible beside the serial resolution path.
- Service and index decisions have an explicit fail-closed evidence gate.

### Negative

- Representative setup takes roughly one minute on the current Windows host.
- Synthetic empty-tree history does not reproduce large source blobs, network
  filesystems, antivirus behavior, or every real notes-tree shape.
- Worktree status remains intentionally serial until the selected follow-up is
  implemented.

## Rejected alternatives

- **Add a registry database immediately:** rejected because registry parsing is
  not the measured bottleneck.
- **Add a resident daemon immediately:** rejected because both slow catalogs
  still have invocation-local process amplification.
- **Benchmark only wall time:** rejected because it would not distinguish Git
  process launches from data-volume cost.
- **Run against the caller repository:** rejected because benchmark safety and
  reproducibility require a disposable, content-independent fixture.
- **Duplicate the specification corpus:** rejected because
  `vcs-lab.spec-benchmark/v2` already measures documentation volume.

## Implementation map

- Fixture, measurements, and decision output: `src/scale-benchmark.js`
- CLI surface and human summary: `src/cli.js`
- Acceptance coverage: `test/integration.test.js`
- Companion documentation benchmark: `src/specs.js`
- Representative measurements and the decision they support: this ADR's
  Initial evidence section
- Active batching implementation:
  [GitHub issue #1](https://github.com/jwh3times/vcs-lab/issues/1)
