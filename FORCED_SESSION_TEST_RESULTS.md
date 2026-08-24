# Forced Git-Session Test Results

## Run summary

| Field | Result |
| --- | --- |
| Process | [FORCED_SESSION_TEST_PROCESS.md](FORCED_SESSION_TEST_PROCESS.md), revision 2 |
| Date | 2026-08-24 |
| Branch | `main` |
| Starting evidence baseline | `d90f67ded25fb772715537c6fbfad03b7bf1d56d` |
| Current source HEAD | `ca1df46473e4ff95df8c261e9901da939fcae723` (`ca1df46`) |
| Node.js | `v26.4.0` |
| npm | `11.16.0` |
| Git | `2.55.0.windows.3` |
| Platform | Windows, PowerShell 7 |

The forced-session defect was reproduced, localized, corrected, and retested. The
available correction gates passed through FS-09. FS-07 is partial because Node 20
is not installed, and FS-10 was intentionally not started because the process
requires a clean committed source checkout before the complete development-plan
rerun.

## Gate summary

| Gate | Result | Evidence |
| --- | --- | --- |
| FS-01 — baseline and evidence preservation | PASS | Baseline and prior evidence were retained; environment and process state were recorded. The final source is intentionally dirty because the correction is uncommitted. |
| FS-02 — diagnostic harness verification | PASS | Race-safe process snapshots, missing-output handling, and gated session diagnostics were installed and exercised. |
| FS-03 — targeted ordinary control | PASS | Ordinary control completed; the complete ordinary suite also passed 43/43. |
| FS-04 — targeted forced direct-console control | PASS, 10/10 | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-fs04-20260824-001852` |
| FS-05 — targeted forced redirected stress | PASS, 20/20 | `C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-fs05-20260824-002232` |
| FS-06 — complete forced redirected suite | PASS, 3/3; ordinary control 1/1 | Forced evidence root: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-fs06-forced-20260824-002905`; ordinary evidence root: `C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-fs06-ordinary-20260824-005240` |
| FS-07 — Node-version matrix | PARTIAL | Current Node passed targeted and complete forced coverage. Node 20 was unavailable and was not installed or substituted during the run. |
| FS-08 — process and fixture analysis | COMPLETE | The pre-fix failure was localized to the exact unanswered session operation. No post-fix failure required additional analysis. |
| FS-09 — static and leak gates | PASS, with source-clean caveat | 33 JavaScript files passed `node --check`, `git diff --check` passed, and no new Node/Git processes remained after the leak check. The source-clean subassertion was not claimed because the requested correction is uncommitted. |
| FS-10 — full development-plan rerun | NOT STARTED | Correctly deferred under the process rule requiring a clean committed source checkout and a complete matrix. |

## Reproduced defect

The targeted forced test was repeated until a failure was captured. The retained
failure root was:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-000817
```

The failing operation was the renamed/reused-workspace scenario's:

```text
reconcile source-two
```

The evidence showed the following sequence:

1. A new persistent Git session was created and entered.
2. The synchronous ordinary check spawned:

   ```text
   git status --porcelain=v1
   ```

   in:

   ```text
   C:\Users\jerry\AppData\Local\Temp\vcs-lab-test-AbgPn9\reuse-workspace
   ```

3. There was no matching `git-spawn-end` event.
4. There was no subsequent `request-start` or request-post event for that
   session.
5. The persistent worker Git process existed, but no object request had been
   posted to it.
6. The root Node process and its descendants remained alive until the exact
   process tree was captured and terminated.

The root process for this retained reproduction was PID `16884`. Its final tree
included the test runner, the isolation process, `vlab.js reconcile source-two`,
the worker's `git cat-file --batch-command`, and the associated console/Git child
processes.

This distinguishes the failure from an unanswered `Atomics.wait`: the failing
run stalled before the first session request was posted. The persistent worker
startup overlapped the synchronous `git status` operation, creating a startup
ordering/race condition in the forced execution context.

## Correction applied

The correction has two parts.

### Process and harness corrections

`FORCED_SESSION_TEST_PROCESS.md` revision 2 now:

- takes process snapshots with null-safe CPU, working-set, and start-time
  fields when a process exits during collection;
- preserves the process tree even when individual process properties cannot be
  read;
- records stdout/stderr availability instead of assuming redirected files
  exist;
- reports the transcript and direct-console evidence when a redirected stream
  file is missing; and
- enables session diagnostics only for the targeted diagnostic runs.

### Session corrections and diagnostics

`src/git.js` and `src/git-session-worker.js` now:

- start the persistent worker lazily, when the first uncached object request
  actually needs it, instead of starting it during session entry;
- record gated diagnostics around session creation, request posting, shared
  memory waits, response parsing, worker errors/exits, and close/disable;
- record the worker's Git stdin writes, stdout response headers, response
  resolution/rejection, Git errors/exits, and close sequence;
- reject pending requests when the worker exits, including a clean Git exit,
  so a pending request cannot wait indefinitely; and
- handle close/disable safely when no worker was started and when posting or
  waiting encounters an error.

The diagnostics are opt-in through:

```text
VLAB_GIT_SESSION_DIAGNOSTICS=1
VLAB_GIT_SESSION_DIAGNOSTICS_FILE=<per-run diagnostics path>
```

Normal runs remain quiet because the diagnostics are disabled unless both the
targeted process enables them and the environment flag is set.

## Post-fix targeted reproduction

After the lazy-worker correction, ten targeted forced redirected iterations were
run with diagnostics enabled. All ten completed with exit code 0, no timeout,
and exactly one selected test passing. The retained run roots were:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001443
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001454
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001505
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001515
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001525
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001539
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001552
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001605
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001616
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-001626
```

A final targeted check after the worker-exit hardening also passed:

```text
Root:    C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-target-20260824-010301
Exit:    0
Elapsed: 12.629 seconds
Timeout: false
```

No unanswered request or forced termination occurred in the post-fix targeted
runs.

## FS-04 — direct-console result

The targeted forced test was run directly against the console ten consecutive
times. Results were:

```text
Iterations: 10
Passed:     10
Failed:      0
Timed out:  0
Terminated: 0
```

Diagnostics were enabled for these runs and were emitted to the console and the
per-run evidence directories. The process tree remained clean after each run.

## FS-05 — redirected stress result

The same targeted forced test was run through the redirected monitored harness
twenty consecutive times. Every iteration reported one test selected, one test
passed, and zero failed:

```text
Iterations: 20
Passed:     20
Failed:      0
Timed out:  0
Terminated: 0
```

The outer evidence root was:

```text
C:\Users\jerry\AppData\Local\Temp\vcs-lab-session-investigation-fs05-20260824-002232
```

Each iteration retained its own stdout, stderr, transcript, process snapshots,
and session diagnostics where available.

## FS-06 — complete suite result

Three complete forced redirected suites passed consecutively:

| Run | Result | Elapsed |
| --- | --- | ---: |
| forced-01 | 43/43/0, exit 0, no timeout | 482.184 s |
| forced-02 | 43/43/0, exit 0, no timeout | 447.815 s |
| forced-03 | 43/43/0, exit 0, no timeout | 445.922 s |

One complete ordinary redirected control also passed:

| Run | Result | Elapsed |
| --- | --- | ---: |
| ordinary-01 | 43/43/0, exit 0, no timeout | 400.349 s |

No run required exact-tree termination, and no VCS Lab-created Node or Git
descendant remained after the runs.

## FS-07 — version coverage

The installed versions were recorded as:

```text
Node.js: v26.4.0
npm:     11.16.0
Git:     2.55.0.windows.3
```

Current Node coverage passed the targeted forced and complete forced cases. Node
20 could not be tested because no Node 20 installation or standard version
manager was present in the environment. The process explicitly prohibited
installing or replacing Node during the active investigation, so this matrix leg
remains unavailable rather than being inferred from the current-version result.

## FS-08 — failure analysis

The pre-fix failure satisfied the investigation exit criteria:

- exact forced mode, selected test, Node version, arguments, environment, and
  start time were retained;
- redirected stdout, stderr, VCS Lab trace, and Git Trace2 evidence were
  retained;
- five-second root/descendant snapshots were captured;
- last output size and last-write timestamps were recorded;
- the newly created `vcs-lab-test-*` fixture path was recorded;
- the process tree was captured immediately before exact-tree termination; and
- the failure was localized to the `git status --porcelain=v1` startup window,
  before the first persistent-session object request.

The post-fix runs produced no failure, so no additional post-fix FS-08 analysis
was necessary.

## FS-09 — static and leak checks

The final audit performed the following checks:

- `node --check` passed for all 33 JavaScript files under `src`, `bin`,
  `test`, and `scripts`;
- `git diff --check` exited successfully;
- no new Node processes were present after the post-run wait; and
- no new Git processes were present after the post-run wait.

The expected source status at handoff was:

```text
 M FORCED_SESSION_TEST_PROCESS.md
 M src/git-session-worker.js
 M src/git.js
```

Those edits are the requested process and product changes. Therefore the strict
clean-checkout subassertion was not represented as a pass.

## Deferred FS-10 and remaining work

FS-10 was not run. The process requires the complete development test plan to
start from a clean committed source checkout, and the required Node 20 matrix
coverage is also unavailable in this environment. Running FS-10 now would not
meet the defined entry conditions and would not be a valid qualification result.

Before release qualification, the remaining work is:

1. Commit or otherwise establish the approved correction in a clean checkout.
2. Run the targeted and complete forced cases on Node 20, if that runtime is
   made available.
3. Start FS-10 from that clean checkout and record the complete mandatory
   `TEST_PLAN.md` result separately.

Temporary runner scripts created for the investigation were removed after use.
The failure roots and successful-run evidence directories listed above were
retained under the system temporary directory.
