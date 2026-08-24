# VCS Lab post-fix test execution

## Run summary

| Field | Result |
| --- | --- |
| Test plan | [TEST_PLAN.md](TEST_PLAN.md), revision 2 |
| Date/time | 2026-08-24, 11:09–11:17 EDT |
| Operator | Codex |
| Computer | `JERRYPC` |
| PowerShell | `7.6.5` |
| Node.js | `v26.4.0` |
| Git | `2.55.0.windows.3` |
| Validation branch | `main` |
| Tested commit | `621eb71771fddacba53a30e22ab25ffbc0397590` |
| Result | **PASS** |

The complete mandatory TP-01 through TP-18 development gate passed from a
clean, LF-configured disposable clone of the committed forced-session
correction. The clone began and ended on the same commit with no worktree
changes, native replay state, or leaked VCS Lab Node/Git process.

The disposable validation checkout was used to avoid changing the separate
linked `main` worktree, which contained pre-existing user changes. The only
source-path adaptation was the clean temporary checkout; its branch, commit,
version, ancestry, and cleanliness assertions ran unchanged.

## Test inventory

| ID | Result | Evidence summary |
| --- | --- | --- |
| TP-01 | PASS | Unique UAT root and transcript created; tools and process baseline recorded |
| TP-02 | PASS | Clean `main`; exact tested commit; baseline ancestor present; version `0.8.0` |
| TP-03 | PASS | Ordinary mode, 43/43, 222.734 seconds |
| TP-04 | PASS | Forced session, 43/43, 194.708 seconds; zero-byte stderr; no timeout |
| TP-05 | PASS | Syntax, whitespace, 23 Markdown files, 128 unique known requirements, clean source |
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
was already dirty with three unrelated deleted `.codex` files. No consumer VCS
Lab command was run, and those files were not changed or restored.

The runner completed 35 selected PowerShell command blocks and recorded 196
passing assertions with zero assertion failures. Failure-only diagnostics,
conditional release TP-19, and cleanup TP-20 were not run.

## Performance and behavior evidence

The Git-session demo produced semantically identical 12-change forecasts:

| Metric | Persistent session | Ordinary Git |
| --- | ---: | ---: |
| Logical queries | 64 | 64 |
| Git processes | 25 | 64 |
| Git time | 1,627.27 ms | 3,284.61 ms |

The process reduction was 60.9%. The doctor probe used one persistent process
for 12 session queries and served 18 immutable-cache hits. Its median/p95 times
were 43.73/52.57 ms for `head`, 48.07/51.53 ms for `status`, 40.67/45.34 ms for
`history`, and 42.93/47.28 ms for `notes`.

## Portability and integrity evidence

| Artifact | SHA-256 |
| --- | --- |
| Export manifest A and B | `F5A5E4268EB51BDC246E3C61A03F9977D300976D1E87977BD932FDDCF8FDBDCA` |
| Export object bundle A and B | `5ED0CA8E6F0BAFFC7291D983DB8BE7AA5DBD7B1287AFC81428D5EE95716B10B4` |

The fresh destination initially lacked the unreachable origin commit. Dry-run
left refs and the worktree unchanged; the first import transported the commit
and three accepted records; the repeated import was a no-op. A modified bundle
failed its integrity check without changing refs or worktree state.

## Retained evidence

| Evidence | Path | SHA-256 |
| --- | --- | --- |
| Transcript | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-110914.log` | `7CFE627266674D26A0F475B8E546869F6377B221EC04C9A472ACC65C3B0F5B62` |
| Forced stdout | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-110914\forced-session.stdout.log` | `B14DC259AE123E01291D2857C0EAC69B99BA1E308F5E25CC43596F785D1AE9BF` |
| Forced stderr | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-110914\forced-session.stderr.log` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| UAT repositories | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-110914` | Retained |
| Clean validation source | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-validation-source-20260824-110800` | Retained at tested commit |

The transcript is 29,618 bytes, forced stdout is 7,920 bytes, and forced stderr
is empty. TP-20 cleanup is intentionally deferred so the evidence remains
available.

## Qualification boundary

The development gate is complete for the tested correction commit. No release
artifact, tag, push, or publication was created; TP-19 was not applicable. This
result is laboratory qualification, not a production-readiness claim.
