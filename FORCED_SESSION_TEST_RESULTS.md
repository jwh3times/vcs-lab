# Forced Git-session correction results

## Run summary

| Field | Result |
| --- | --- |
| Process | [FORCED_SESSION_TEST_PROCESS.md](FORCED_SESSION_TEST_PROCESS.md), revision 2 |
| Date | 2026-08-24 |
| Worktree branch | `bristlemouth` |
| Candidate base HEAD | `ca1df46473e4ff95df8c261e9901da939fcae723` |
| Current Node.js | `v26.4.0` |
| Compatibility Node.js | `v20.20.2` via isolated `npm exec --package=node@20` runtime |
| Git | `2.55.0.windows.3` |
| Platform | Windows, PowerShell 7 |

The forced-session defect was reproduced, localized, corrected, and qualified
through the complete focused correction gate. The focused gate qualifies the
candidate correction; the clean-checkout development plan and any release
qualification remain separate follow-up gates.

## Root cause

The retained pre-fix reproduction is:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-000817
```

The failing command was `vlab reconcile source-two` in the renamed,
cross-worktree resolution-reuse scenario. Gated lifecycle diagnostics showed:

1. `GitObjectSession` was created and its worker began starting immediately.
2. The main thread entered the ordinary `git status --porcelain=v1` preflight.
3. No matching `git-spawn-end` event appeared.
4. No object request had been posted and `Atomics.wait` had not begun.
5. The worker's `git cat-file --batch-command` process remained live while the
   main thread was blocked inside the synchronous Git call.

The defect was therefore an eager-start ordering race on Windows, not an
unanswered shared-memory request or a deterministic resolution error. Starting
the worker concurrently with the first synchronous Git preflight could leave
that preflight waiting indefinitely.

## Correction

The corrected lifecycle now:

- creates the worktree-scoped session without starting a worker;
- starts the worker only when the first uncached object request is ready to be
  posted, after synchronous preflight checks have completed;
- rejects every pending request if the worker's Git process exits, including a
  clean but unexpected exit, so ordinary Git fallback can take over;
- handles close/disable when no worker was needed;
- records opt-in lifecycle diagnostics through
  `VLAB_GIT_SESSION_DIAGNOSTICS=1` and a per-run diagnostics file;
- acknowledges shutdown only after the child process `close` event, when stdio
  has drained; and
- retains bounded graceful termination plus a Windows process-tree kill
  fallback for a Git child that does not close after EOF.

The integration suite now asserts both lifecycle boundaries directly: a
dirty-worktree reconciliation must complete its `git status` preflight and
close without creating a worker, while a normal object session must observe
`git-close` before `close-finish` without invoking the kill fallback.

## Correction-gate results

| Gate | Result |
| --- | --- |
| Targeted ordinary control | PASS |
| Targeted forced direct-console control | PASS, 10/10 consecutive |
| Targeted forced redirected control | PASS, 20/20 consecutive |
| Complete forced suite, current Node | PASS, 3/3 consecutive |
| Complete ordinary suite, current Node | PASS, 1/1 |
| Targeted forced suite, Node 20 | PASS |
| Complete forced suite, Node 20 | PASS, 1/1 |
| Process leaks and forced termination | PASS, zero leaks and zero forced terminations |
| Maintained demos and doctor | PASS, 6/6 demos plus benchmark |
| Static syntax/whitespace/link/requirement gates | PASS, with the focused-run source-clean caveat below |
| Complete `TEST_PLAN.md` rerun | PASS; see [POST_FIX_TEST_RESULTS.md](POST_FIX_TEST_RESULTS.md) |

### Targeted forced stress

The direct sequence completed 10/10 in 6.63–7.07 seconds per run. The redirected
sequence completed 20/20 in 12.32–12.63 seconds per run with diagnostics and Git
Trace2 enabled. Each redirected trace contained 135 Git starts and 135 exits:
2,700 balanced starts/exits in total, with zero request timeouts, worker errors,
shutdown kills, malformed responses, or leaked descendants.

Evidence root:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-correction-20260824-101217
```

### Complete current-Node suites

| Run | Mode | Result | Elapsed | Git starts/exits | Leaks |
| --- | --- | --- | ---: | ---: | ---: |
| forced-01 | Forced | 43/43/0 | 284.415 s | 3,471 / 3,471 | 0 |
| forced-02 | Forced | 43/43/0 | 270.512 s | 3,471 / 3,471 | 0 |
| forced-03 | Forced | 43/43/0 | 270.496 s | 3,471 / 3,471 | 0 |
| ordinary-01 | Ordinary | 43/43/0 | 336.431 s | 3,756 / 3,756 | 0 |

Evidence roots:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-full-correction-20260824-101718
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-ordinary-correction-20260824-103136
```

### Node 20 compatibility

Node `v20.20.2` passed the targeted exact-resolution, lazy-start, and fallback
checks. Its complete forced suite passed 43/43/0 in 370.795 seconds with 3,475
Git starts, 3,475 exits, no timeout, and no leaked descendant.

Evidence root:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-node20-correction-20260824-103824
```

### Maintained demos and metrics

All six maintained demos and `doctor --benchmark --samples 10 --warmup 2`
completed. The 12-change session comparison produced an identical forecast with
25 Git processes versus 64 ordinary processes, a 60.9% reduction. The doctor
object probe used one process for 12 session queries and served 18 additional
logical reads from the immutable-object cache.

## Static and packaging audit

- all 33 JavaScript files under `src`, `bin`, `test`, and `scripts` passed
  `node --check`;
- `git diff --check` passed;
- all local links across 23 Markdown files resolved;
- all 128 formal FR/NFR definitions were unique and every reference was known;
- source HEAD remained `ca1df46473e4ff95df8c261e9901da939fcae723`;
- no VCS Lab Node or Git process remained; and
- `npm pack --dry-run --json` succeeded with 59 files and no runtime dependency.

The package dry run emitted the existing `.gitignore` fallback warning because
the repository has no `.npmignore`; it did not create an archive. The strict
source-clean assertion was outside this focused candidate run and was later
established by the complete clean-checkout development plan.

## Qualification boundary

This result closes the focused forced-session correction gate. It does not
authorize a release. The subsequent full development gate passed from the
committed correction; see [POST_FIX_TEST_RESULTS.md](POST_FIX_TEST_RESULTS.md).
Release artifacts and publishing remain out of scope unless explicitly
requested.
