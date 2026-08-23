# VCS Lab test execution

- Date/time: 2026-08-22, 10:47–11:23 EDT
- Operator: Codex
- Computer: JERRYPC
- PowerShell: 7.6.5
- Node: v26.4.0
- Git: git version 2.55.0.windows.3
- Branch: `main`
- Commit: `2a28f679189e04b8be07d930e41d292d65bc82ae`
- Test plan: [TEST_PLAN.md](TEST_PLAN.md)

## Results

| Test plan item | Result |
| --- | --- |
| TP-01 Bootstrap | PASS |
| TP-02 Source/version | PASS |
| TP-03 Ordinary suite | PASS — 43/43, 0 failures |
| TP-04 Forced-session suite | FAIL — stalled without producing a test summary; interrupted after more than four minutes |
| TP-05 Static gates | PASS |
| TP-06 Demos and session comparison | PASS — 6/6 demos and doctor benchmark |
| TP-07 Consumer smoke | PASS |
| TP-08 Clean reviewed rebase | PASS |
| TP-09 Envelope/import/idempotence | PASS |
| TP-10 Tamper rejection | PASS |
| TP-11 Stale forecast | PASS |
| TP-12 Conflict/fork/isolation | PASS |
| TP-13 Partial abort | PASS |
| TP-14 Unexpected empty replay | PASS |
| TP-15 Resolution reuse | PASS |
| TP-16 Candidate policy | PASS |
| TP-17 Merge topology | PASS |
| TP-18 Final audit | PASS |
| TP-19 Release artifacts | NOT RUN — conditional release-candidate test |
| TP-20 Cleanup | RETAINED — cleanup is prohibited after a failed mandatory test |

## Git-session demo

| Measure | Result |
| --- | --- |
| Logical queries | 64 |
| Session processes | 25 |
| Ordinary processes | 64 |
| Process reduction | 60.9% |
| Semantic equality | YES |

Doctor benchmark median/p95 (ms): head 32.84/36.43, status 38.04/51.98, history 38.09/52.54, notes 33.00/39.61. The object session used 1 Git process, 12 session queries, and 18 cache hits.

## Metadata portability

| Measure | Result |
| --- | --- |
| Manifest SHA-256 | `D92C5AEBAE1FA7965F368C4BDB771038D1F56ADFDD388F80301977731E6857C1` |
| Bundle SHA-256 | `BD6D5A917E8FE81ADFF11314D83123F8AB7DBB94B9E17E894581641BA8EEAF8B` |
| Dry-run refs unchanged | YES |
| First import changed | YES |
| Repeated import no-op | YES |
| Unreachable origin transported | YES |
| Tamper rejected | YES |
| Tamper refs unchanged | YES |

## Execution notes and evidence

- TP-04 was run with `VLAB_GIT_SESSION=1`. The Node test runner and persistent Git workers stopped making progress and produced no `43/43` summary. The exact VCS Lab processes left by the interrupted run were terminated; the later TP-18 process audit passed.
- The final successful run used a temporary `GIT_CONFIG_GLOBAL` with `core.autocrlf=false`, matching the plan’s LF fixture assumptions. Without it, the host Git default converted the fresh clone and caused TP-09’s clean-worktree assertion to fail.
- TP-06 required elevated execution because the sandbox denies writes to the source `.git/config`; the doctor benchmark itself passed. TP-07 required elevated read-only execution because the consumer checkout is owned by the host user and is rejected as dubious ownership inside the sandbox.
- Retained forced-session evidence: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260822-110934.log` and its UAT root.
- Retained successful manual-case evidence: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260822-112247.log` and `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260822-112247`.

Final result: **FAIL** — TP-04 forced-session suite did not complete.

Open defect: investigate the forced-session `npm test` stall and its process cleanup behavior.

## Follow-up diagnostic — 2026-08-23

The failed gate was reproduced against the same implementation commit with the
same `VLAB_GIT_SESSION=1` setting and allowed to continue beyond four minutes.
It completed successfully with 43/43 passing tests, zero failures, and a total
duration of 249,537 ms. No Git worker remained afterward.

The ordinary suite also completed with 43/43 passing tests in 247,973 ms. These
measurements show that the original TP-04 run was interrupted near its normal
completion time; they do not support a persistent-session deadlock or a product
code correction. The original result above remains the record of that execution
and is not retroactively rewritten.

[TEST_PLAN.md](TEST_PLAN.md) revision 2 now permits a 12-minute monitored run,
captures both test streams, terminates only the exact test process tree on a real
timeout, and applies LF configuration before fresh-clone checkout. A complete
revision-2 execution is still required for a new release-gate result.
