# Repository-scale benchmark and qualification results

## Run summary

| Field | Result |
| --- | --- |
| Test plan | [TEST_PLAN.md](TEST_PLAN.md), revision 2 |
| Date/time | 2026-08-24, 12:54–13:07 EDT |
| Operator | Codex |
| Computer | `JERRYPC` |
| PowerShell | `7.6.5` |
| Node.js | `v26.4.0` |
| Git | `2.55.0.windows.3` |
| Validation branch | `main` |
| Tested commit | `fd8ade038995df36c98f992e051c8a4cf5d93065` |
| Result | **PASS** |

The complete mandatory TP-01 through TP-18 development gate passed from a
clean disposable clone of the committed ADR-0013 repository-scale increment.
The clone began and ended on the exact tested commit with no source changes,
native replay state, or leaked VCS Lab Node/Git process. The representative
repository and specification benchmarks then passed from that same clone.

## Test inventory

| ID | Result | Evidence summary |
| --- | --- | --- |
| TP-01 | PASS | Unique UAT root and transcript created; tools and process baseline recorded |
| TP-02 | PASS | Clean `main`; exact tested commit; baseline ancestor present; version `0.8.0` |
| TP-03 | PASS | Ordinary mode, 43/43, 231.119 seconds |
| TP-04 | PASS | Forced session, 43/43, 215.214 seconds; zero-byte stderr; no timeout |
| TP-05 | PASS | Syntax, whitespace, 27 Markdown files, 128 unique known requirements, clean source |
| TP-06 | PASS | Six maintained demos and doctor benchmark |
| TP-07 | SKIP | Recommended consumer smoke was not run because its named checkout had pre-existing changes |
| TP-08 | PASS | Deterministic plan/forecast, caller preservation, reviewed apply, stable identity, valid metadata |
| TP-09 | PASS | Deterministic envelope, clean fresh clone, no-op preview, applied and idempotent import |
| TP-10 | PASS | Tampered payload rejected without ref or worktree mutation |
| TP-11 | PASS | Stale forecast rejected without branch movement or journal creation |
| TP-12 | PASS | Conflict isolated to owner worktree; explicit fork completed and validated |
| TP-13 | PASS | Partial replay published no shared receipt; abort restored exact commit and tree |
| TP-14 | PASS | Unexpected empty replay blocked and remained exactly abortable |
| TP-15 | PASS | Exact resolution was retained, pinned in forecast, batch-applied, and validated |
| TP-16 | PASS | Heuristic equivalence required review; explicit acceptance was recorded without replay |
| TP-17 | PASS | Merge topology rejected before mutation with no journal |
| TP-18 | PASS | No new Node/Git process; source commit, branch, and cleanliness preserved |

TP-07 is recommended rather than mandatory. Its configured consumer repository
was on `main`, one commit ahead of its remote, with three unrelated deleted
`.codex` files. No consumer VCS Lab command was run, and those files were not
changed or restored.

The successful runner executed 34 exact plan fences plus its adapted clean-clone
bootstrap and recorded 196 passing assertions with zero assertion failures.
Failure-only diagnostics, conditional release TP-19, and cleanup TP-20 were not
run.

## Increment-specific integration evidence

The existing doctor/session integration scenario now also invokes a bounded
custom repository-scale profile in both ordinary and forced-session modes. It
proved:

- the exact `vcs-lab.repository-scale-benchmark/v1` fixture and semantic scan
  results;
- three workspace-status Git processes per registered workspace, a sub-one
  note-catalog process ratio, and amplified resolution traversal;
- a `batch-process-amplified-scans` decision with no current index or resident
  service recommendation;
- no caller `HEAD`, porcelain status, or worktree-list change;
- no caller/fixture path, object ID, file content, or commit message in JSON;
  and
- actual removal of the uniquely prefixed disposable fixture directory.

## Representative repository-scale evidence

The default bounded profile used 250 reachable commits, 12 registered linked
worktrees plus the main worktree, 250 causal notes, 50 retained resolutions,
300 total note targets, and three samples. Fixture setup was reported
separately: 56,403.83 ms, 1,148 logical queries/processes, 362 expected
absent-probe failures, and zero unexpected Git failures. End-to-end setup,
measurement, analysis, and cleanup took 82.088 seconds.

| Phase and semantic result | Cold ms | Warm median ms | Median ms | p95 ms | Median Git processes |
| --- | ---: | ---: | ---: | ---: | ---: |
| History: 250 commits | 72.74 | 70.53 | 72.74 | 74.94 | 1 |
| Git worktrees: 13 | 65.25 | 59.08 | 59.29 | 65.25 | 1 |
| Workspace registry: 12 | 0.47 | 0.29 | 0.31 | 0.47 | 0 |
| Workspace status: 12 active, 0 dirty | 1,637.73 | 1,572.20 | 1,597.78 | 1,637.73 | 36 |
| Note catalog: 300 records | 183.79 | 169.79 | 172.67 | 183.79 | 2 |
| Resolution catalog: 50 records | 5,503.66 | 5,375.51 | 5,503.66 | 5,521.65 | 103 |
| Metadata status: valid, 300 accepted records | 1,492.43 | 768.18 | 780.25 | 1,492.43 | 11 |

All three samples in every phase returned equal semantic results. Process counts
were stable except complete metadata status: its cold sample used 23 processes
while both warm samples used 11 after invocation-scoped repository context was
available.

### Decision output

| Scan | Process amplification | Decision |
| --- | ---: | --- |
| Workspace status | 3 processes/workspace | Batch identity, head, and porcelain discovery first |
| Note catalog | 0.007 processes/target | Retain the existing batched scan |
| Resolution catalog | 2.06 processes/resolution | Replace per-ref resolve/show traversal with batched validation first |

Workspace status and resolution catalog were the only median measurements over
the configured 1,000 ms interactive budget. The schema therefore selected
`batch-process-amplified-scans`. A persistent index was not recommended because
avoidable per-entity process costs remain. The resident-service gate was not
reached because invocation-local batching opportunities remain and one local
synthetic run is insufficient for service lifecycle, locking, security, and
upgrade costs.

The benchmark reported all four privacy exclusions. Independent before/after
checks confirmed exact preservation of the caller commit, worktree status, and
worktree list, plus preservation of the system-temp directory set matching the
fixture prefix after cleanup.

## Companion documentation-scale evidence

The exact commit's `vcs-lab.spec-benchmark/v2` default profile covered 25
documents, 40 heading blocks per document, and 2,025 semantic entities.

| Metric | Result |
| --- | ---: |
| Source bytes | 115,929 |
| Sparse v3 manifest bytes | 11,240 |
| Legacy v2 equivalent bytes | 655,545 |
| Metadata reduction versus v2 | 98.29% |
| Estimated compressed reduction versus v2 | 94.96% |
| Cold total / content reads | 153.05 ms / 25 |
| Unchanged total / content reads / blob hits | 6.54 ms / 0 / 25 |
| One-block-change total / content reads / blob hits | 96.01 ms / 1 / 24 |

This companion covers the documentation-volume dimension without duplicating
it inside the repository/shared-metadata fixture.

## Other performance and integrity evidence

The Git-session demo produced semantically identical 12-change forecasts:

| Metric | Persistent session | Ordinary Git |
| --- | ---: | ---: |
| Logical queries | 64 | 64 |
| Git processes | 25 | 64 |
| Git time | 1,688.48 ms | 3,257.62 ms |

The process reduction was 60.9%. The doctor object probe used one persistent
process for 12 session queries and served 18 immutable-cache hits. Its
median/p95 times were 39.20/41.21 ms for `head`, 48.31/55.22 ms for `status`,
46.85/53.00 ms for `history`, and 42.02/53.55 ms for `notes`.

| Artifact | SHA-256 |
| --- | --- |
| Export manifest A and B | `8F7556497BFE89B122F592C578C8410D3D343C650F457DDD79BDCF621ACE6231` |
| Export object bundle A and B | `0964CFCBEF79802AA80A0F1A1D3619F33A99C90EF129DA07A0688D677BDCB5A6` |

The fresh destination initially lacked the unreachable origin commit. Dry-run
left refs and the worktree unchanged; the first import transported the commit
and three accepted records; the repeated import was a no-op. A modified bundle
failed its integrity check without changing refs or worktree state.

## Retained evidence

| Evidence | Path | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Transcript | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-125433.log` | 27,008 | `7E521269EFBF8B2351697576E9708786786EE3D5F73720DCB134B6539B4C1632` |
| Forced stdout | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-125433\forced-session.stdout.log` | 8,008 | `6D7FE9B05095618EF2E55142FEC931C74A0B9B4300D97CB9131BE686DFF9A08C` |
| Forced stderr | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-125433\forced-session.stderr.log` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| UAT repositories | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-125433` | — | Retained |
| Clean validation source | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-scale-qualification-20260824-125331-d1a05aa6\source` | — | Retained at tested commit |

TP-20 cleanup is intentionally deferred so this evidence remains available.

## Qualification boundary

The development gate and bounded scale decision are complete for the tested
feature commit. No release artifact, tag, push, or publication was created;
TP-19 was not applicable. These measurements are synthetic evidence from one
Windows host, not a fixed production scale claim. Real-repository and
non-Windows post-batching evidence remain required before a persistent index or
resident service decision.
