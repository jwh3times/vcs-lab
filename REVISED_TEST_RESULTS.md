# VCS Lab revised test execution

- Test-plan revision: 2
- Date/time: 2026-08-23, 11:49–12:05 EDT
- Operator: Codex
- Computer: JERRYPC
- PowerShell: 7.6.5
- Node: v26.4.0
- Git: git version 2.55.0.windows.3
- Branch: `main`
- Commit: `d90f67ded25fb772715537c6fbfad03b7bf1d56d`
- Test plan: [TEST_PLAN.md](TEST_PLAN.md)

## Results

| Test plan item | Result |
| --- | --- |
| TP-01 Bootstrap | PASS |
| TP-02 Source/version | PASS |
| TP-03 Ordinary suite | PASS — 43/43, 0 failures; 174.07 seconds |
| TP-04 Forced-session suite | FAIL — monitored runner timed out at 720.5 seconds |
| TP-05 Static gates | NOT RUN — stopped after TP-04 failure |
| TP-06 Demos and session comparison | NOT RUN |
| TP-07 Consumer smoke | NOT RUN |
| TP-08 Clean reviewed rebase | NOT RUN |
| TP-09 Envelope/import/idempotence | NOT RUN |
| TP-10 Tamper rejection | NOT RUN |
| TP-11 Stale forecast | NOT RUN |
| TP-12 Conflict/fork/isolation | NOT RUN |
| TP-13 Partial abort | NOT RUN |
| TP-14 Unexpected empty replay | NOT RUN |
| TP-15 Resolution reuse | NOT RUN |
| TP-16 Candidate policy | NOT RUN |
| TP-17 Merge topology | NOT RUN |
| TP-18 Final audit | NOT RUN — failure capture completed instead |
| TP-19 Release artifacts | NOT RUN — conditional release-candidate test |
| TP-20 Cleanup | RETAINED — cleanup is prohibited after a failed mandatory test |

## TP-04 evidence

Revision 2’s monitored runner launched the exact Node test process with
`VLAB_GIT_SESSION=1`, reported activity every 15 seconds, and allowed the full
12-minute deadline. The process remained alive with approximately 0.17 seconds
of CPU time and produced no TAP summary. At 720.5 seconds the runner used
`taskkill.exe /PID <exact-pid> /T /F`, then the completion assertion failed.

The captured stdout contains 2,914 bytes of Git/test fixture progress; stderr
is empty. The forced run did not report `43` tests, `43` passes, or zero
failures.

## Failure capture

The prescribed diagnostics at 2026-08-23T12:05:30-04:00 reported:

- source branch `main` at `d90f67ded25fb772715537c6fbfad03b7bf1d56d`;
- no active rebase, reconcile, or resolution operation;
- metadata status and validation both valid with zero errors and warnings; and
- no VCS Lab-created Node or Git process remaining after tree termination.

The prior `TEST_RESULTS.md` was restored unchanged before the revised run so
the source-clean entry gate was genuine. This report is being added after the
test run.

## Retained evidence

- UAT root: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937`
- Transcript: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937.log`
- Forced stdout: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937\forced-session.stdout.log`
- Forced stderr: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937\forced-session.stderr.log`

Final result: **FAIL** — TP-04 forced-session integration suite exceeded the
revised 12-minute deadline.

Open defect: investigate why the forced-session integration suite remains
alive without completing under the bounded monitor.
