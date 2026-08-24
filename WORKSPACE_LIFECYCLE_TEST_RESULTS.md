# Workspace lifecycle and checkpoint-forecast test execution

## Run summary

| Field | Result |
| --- | --- |
| Test plan | [TEST_PLAN.md](TEST_PLAN.md), revision 2 |
| Date/time | 2026-08-24, 11:59–12:08 EDT |
| Operator | Codex |
| Computer | `JERRYPC` |
| PowerShell | `7.6.5` |
| Node.js | `v26.4.0` |
| Git | `2.55.0.windows.3` |
| Validation branch | `main` |
| Tested commit | `c4d16c244d79ec02c214304958af488e978f7ba9` |
| Result | **PASS** |

The complete mandatory TP-01 through TP-18 development gate passed from a
clean, LF-configured disposable clone of the committed workspace lifecycle and
checkpoint-forecast increment. The clone began and ended on the exact tested
commit with no worktree changes, native replay state, or leaked VCS Lab
Node/Git process.

## Test inventory

| ID | Result | Evidence summary |
| --- | --- | --- |
| TP-01 | PASS | Unique UAT root and transcript created; tools and process baseline recorded |
| TP-02 | PASS | Clean `main`; exact tested commit; baseline ancestor present; version `0.8.0` |
| TP-03 | PASS | Ordinary mode, 43/43, 227.909 seconds |
| TP-04 | PASS | Forced session, 43/43, 239.210 seconds; zero-byte stderr; no timeout |
| TP-05 | PASS | Syntax, whitespace, 25 Markdown files, 128 unique known requirements, clean source |
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

The successful runner completed 35 selected PowerShell command blocks and
recorded 196 passing assertions with zero assertion failures. Failure-only
diagnostics, conditional release TP-19, and cleanup TP-20 were not run.

## Increment-specific evidence

The integration suite keeps its 43-scenario contract by expanding the two
existing workspace scenarios. Both ordinary and forced modes proved:

- dirty worktree move preserves workspace ID, branch, path history, checkpoint
  identity, status, and bytes;
- archive refuses tracked/untracked changes and separately refuses ignored
  files, while clean archive/restore preserves the branch and last head;
- stale-path repair and preview/apply prune preserve the logical workspace,
  retained checkpoint refs, and restorable branch;
- checkpoints have deterministic `draft_` identity, a captured-head parent,
  proper trailers, and retained history refs when latest advances;
- committed-head forecast behavior remains unchanged;
- `--source-checkpoint` pins checkpoint/base/tree/draft identity, applies the
  captured draft, and excludes later live-only bytes; and
- both new forecast creation and an already-reviewed approval reject a source
  branch that moved after capture, before target mutation.

## Performance and behavior evidence

The Git-session demo produced semantically identical 12-change forecasts:

| Metric | Persistent session | Ordinary Git |
| --- | ---: | ---: |
| Logical queries | 64 | 64 |
| Git processes | 25 | 64 |
| Git time | 1,583.92 ms | 3,197.87 ms |

The process reduction was 60.9%. The doctor probe used one persistent process
for 12 session queries and served 18 immutable-cache hits. Its median/p95 times
were 40.67/45.39 ms for `head`, 45.15/49.28 ms for `status`, 40.84/46.85 ms for
`history`, and 38.34/42.87 ms for `notes`.

## Portability and integrity evidence

| Artifact | SHA-256 |
| --- | --- |
| Export manifest A and B | `DF50763F9A2F8B5EBED8BACCD00B5068F142C0FC0D7AF20F8764E06561B4761F` |
| Export object bundle A and B | `3CF00AD937E13B08621F5C0105CD74AC65600B829D9B41A43BBB717B8C82743C` |

The fresh destination initially lacked the unreachable origin commit. Dry-run
left refs and the worktree unchanged; the first import transported the commit
and three accepted records; the repeated import was a no-op. A modified bundle
failed its integrity check without changing refs or worktree state.

## Retained evidence

| Evidence | Path | SHA-256 |
| --- | --- | --- |
| Transcript | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-115933.log` | `7A584BE7967AC2F1492E1160008BAB6D461B5978416B9E1F1C147B86CA547767` |
| Forced stdout | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-115933\forced-session.stdout.log` | `38674DE34BDADE963B0B48621091CB1B7A11AD35F0CC19F805534E3093D2C0FC` |
| Forced stderr | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-115933\forced-session.stderr.log` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| UAT repositories | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260824-115933` | Retained |
| Clean validation source | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-workspace-validation-source-20260824-115852` | Retained at tested commit |

The transcript is 27,039 bytes, forced stdout is 8,005 bytes, and forced stderr
is empty. TP-20 cleanup is intentionally deferred so the evidence remains
available.

## Qualification boundary

The development gate is complete for the tested feature commit. No release
artifact, tag, push, or publication was created; TP-19 was not applicable. This
result is laboratory qualification, not a production-readiness claim.
