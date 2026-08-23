# Forced Git-Session Hang Test Process

## 1. Document control

| Field | Value |
| --- | --- |
| Product | causal-vcs-lab |
| Process revision | 1 |
| Prepared | 2026-08-23 |
| Branch | `main` |
| Evidence baseline | `d90f67ded25fb772715537c6fbfad03b7bf1d56d` |
| Primary platform | Windows, PowerShell 7, Node.js 20+, Git |
| Related test plan | [TEST_PLAN.md](TEST_PLAN.md), revision 2 |
| Triggering result | [REVISED_TEST_RESULTS.md](REVISED_TEST_RESULTS.md) |

## 2. Purpose

This document defines the test process for reproducing, localizing, correcting,
and qualifying the intermittent forced persistent-Git-session hang observed in
TP-04.

The process has two separate gates:

1. **Investigation gate:** capture enough evidence to identify the exact blocked
   Node, VCS Lab, and Git process and the last test operation that completed.
2. **Correction gate:** demonstrate that the fix is repeatable under targeted,
   cumulative, redirected, and full-suite execution before rerunning the complete
   release test plan.

This process does not replace `TEST_PLAN.md`. Passing it permits a full test-plan
rerun; it does not by itself authorize a release.

## 3. Known evidence and working boundary

The revised result established the following:

- ordinary mode completed 43/43 tests;
- forced-session mode stopped producing output approximately 111 seconds after
  launch and exceeded a 12-minute deadline;
- fixture output stopped in test 34, `exact conflict resolutions are suggested
  and reused across worktrees`, after `target-one` was created and before or
  during `vlab reconcile source-one`;
- the parent Node process remained alive with multiple descendants;
- exact process-tree termination removed the descendants; and
- the same implementation has also completed a forced-session run successfully,
  so the defect is intermittent or execution-context-sensitive.

Do not classify the defect as a simple performance failure. A run is considered
hung only when it exceeds its case-specific deadline. The monitor must preserve
the last output timestamp and a snapshot of every descendant process before
termination.

## 4. Safety rules

1. Run source checks only in the named `vcs-lab` checkout.
2. Let Node tests create their repositories under `$env:TEMP`; never point a
   diagnostic test at a valuable consumer repository.
3. Terminate only the exact process-tree root returned by `Start-Process`.
4. Capture the descendant tree before using `taskkill.exe /T /F`.
5. Stop at the first unexpected timeout, nonzero exit, process leak, or Git lock.
6. Retain every failed run directory and transcript.
7. Remove only a test root whose absolute path is inside `$env:TEMP` and whose
   leaf name starts with `vcs-lab-session-investigation-`.
8. Do not edit product code during an evidence-capture run.
9. Do not treat absence of TAP output alone as a hang; use the deadline, output
   timestamps, process tree, and exit code together.
10. Do not run release-artifact validation until the correction gate and the
    complete development test plan both pass.

## 5. Entry criteria

- PowerShell 7, Node.js, Git, and `rg` are available.
- `Get-CimInstance Win32_Process` is permitted. If it returns access denied,
  restart PowerShell with the elevation required by the host before continuing.
- The source checkout is on `main` and clean.
- The retained revised-result evidence still exists or has been archived.
- No source-worktree rebase, reconcile, merge, or cherry-pick is active.
- No unrelated test runner is using a `vcs-lab-test-*` temporary directory.
- At least 5 GB of temporary disk space is available.

## 6. Exit criteria

### 6.1 Investigation exit

The investigation phase is complete when a failed run has all of the following:

- exact test mode, Node version, arguments, environment, and start time;
- stdout, stderr, VCS Lab trace, and Git Trace2 evidence;
- five-second snapshots for the root and every descendant process;
- last output size and last-write timestamp;
- newly created `vcs-lab-test-*` fixture paths;
- process tree captured immediately before exact-tree termination; and
- localization to a test name and the nearest VCS Lab/Git operation.

### 6.2 Correction exit

A candidate fix qualifies only when:

- targeted ordinary control passes once;
- targeted forced direct-console control passes 10/10;
- targeted forced redirected control passes 20/20;
- the complete forced suite passes 3/3 with redirected evidence capture;
- the complete ordinary suite passes once;
- Node 20 and the current Node version each pass at least one targeted forced run
  and one complete forced run;
- no run requires forced termination;
- no VCS Lab-created Node or Git descendant remains after any run;
- JavaScript syntax, Markdown links, requirement IDs, and whitespace pass; and
- the complete mandatory portion of `TEST_PLAN.md` subsequently passes.

Any failure resets the consecutive-pass count for that case.

## 7. Test sequence

| ID | Case | Required during investigation | Required after fix |
| --- | --- | --- | --- |
| FS-01 | Baseline and evidence preservation | Yes | Yes |
| FS-02 | Diagnostic harness verification | Yes | Yes |
| FS-03 | Targeted ordinary control | Yes | Yes |
| FS-04 | Targeted forced direct-console control | Yes | 10 consecutive |
| FS-05 | Targeted forced redirected stress | Until reproduction | 20 consecutive |
| FS-06 | Complete forced redirected suite | Until reproduction | 3 consecutive |
| FS-07 | Node-version matrix | Recommended | Yes |
| FS-08 | Process and fixture analysis | On every failure | No failures allowed |
| FS-09 | Static and leak gates | Yes | Yes |
| FS-10 | Full development-plan rerun | No | Yes |

## 8. FS-01 — Baseline and evidence preservation

### 8.1 Create the investigation root

Open a new PowerShell 7 window and run:

```powershell
$sourceRepo = "C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab"
Set-Location $sourceRepo

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$investigationRoot = Join-Path $env:TEMP "vcs-lab-session-investigation-$stamp"
$transcript = Join-Path $investigationRoot "investigation.log"
$expectedBranch = "main"
$sourceHeadAtStart = git rev-parse HEAD
$investigationStarted = Get-Date

New-Item -ItemType Directory -Path $investigationRoot | Out-Null
Start-Transcript -LiteralPath $transcript

Write-Host "Investigation root: $investigationRoot"
Write-Host "Transcript:        $transcript"
```

### 8.2 Assert the source baseline

```powershell
function Assert-True {
    param([bool]$Condition, [string]$Label)
    if (-not $Condition) { throw "ASSERTION FAILED: $Label" }
    Write-Host "PASS: $Label" -ForegroundColor Green
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Label)
    if ($Expected -ne $Actual) {
        throw "ASSERTION FAILED: $Label`nExpected: $Expected`nActual:   $Actual"
    }
    Write-Host "PASS: $Label" -ForegroundColor Green
}

$actualBranch = git branch --show-current
$sourceStatus = (git status --porcelain=v1) -join "`n"

Assert-Equal $expectedBranch $actualBranch "Expected source branch"
Assert-Equal "" $sourceStatus "Source checkout is clean"

git merge-base --is-ancestor d90f67d $sourceHeadAtStart
Assert-Equal 0 $LASTEXITCODE "Source contains the evidence baseline"

$activeGitStates = @(
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "MERGE_HEAD",
    "REBASE_HEAD"
) | Where-Object {
    git rev-parse --verify --quiet $_ 2>$null
    $LASTEXITCODE -eq 0
}

Assert-Equal 0 $activeGitStates.Count "No native Git operation is active"
```

### 8.3 Record environment and process baselines

```powershell
$baselineNodeIds = @(
    Get-Process node -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Id
)
$baselineGitIds = @(
    Get-Process git -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Id
)

$environmentRecord = [pscustomobject]@{
    Timestamp = Get-Date -Format "o"
    Computer = $env:COMPUTERNAME
    PowerShell = $PSVersionTable.PSVersion.ToString()
    Node = (& node --version)
    Git = (& git --version)
    Branch = $actualBranch
    Commit = $sourceHeadAtStart
    InvestigationRoot = $investigationRoot
    BaselineNodeIds = $baselineNodeIds
    BaselineGitIds = $baselineGitIds
}

$environmentRecord | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $investigationRoot "environment.json")
$environmentRecord | Format-List
```

### 8.4 Preserve hashes of prior evidence

```powershell
$priorEvidence = @(
    "C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937.log",
    "C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937\forced-session.stdout.log",
    "C:\Users\jerry\AppData\Local\Temp\vcs-lab-uat-20260823-114937\forced-session.stderr.log"
)

$availablePriorEvidence = @(
    $priorEvidence | Where-Object { Test-Path -LiteralPath $_ }
)

if ($availablePriorEvidence.Count -gt 0) {
    Get-FileHash -Algorithm SHA256 -LiteralPath $availablePriorEvidence |
        Export-Csv -NoTypeInformation -LiteralPath (
            Join-Path $investigationRoot "prior-evidence-hashes.csv"
        )
}

Write-Host "Prior evidence files found: $($availablePriorEvidence.Count)"
```

Do not delete or alter the prior evidence.

## 9. FS-02 — Diagnostic harness

### 9.1 Install process-tree snapshot helper

```powershell
function Get-ProcessTreeSnapshot {
    param([int]$RootProcessId)

    $allProcesses = @(Get-CimInstance Win32_Process)
    $processIds = [System.Collections.Generic.List[int]]::new()
    $processIds.Add($RootProcessId)

    for ($index = 0; $index -lt $processIds.Count; $index += 1) {
        $parentId = $processIds[$index]
        foreach ($child in $allProcesses) {
            if (
                [int]$child.ParentProcessId -eq $parentId -and
                -not $processIds.Contains([int]$child.ProcessId)
            ) {
                $processIds.Add([int]$child.ProcessId)
            }
        }
    }

    foreach ($processId in $processIds) {
        $cim = $allProcesses |
            Where-Object { [int]$_.ProcessId -eq $processId } |
            Select-Object -First 1
        $runtime = Get-Process -Id $processId -ErrorAction SilentlyContinue

        [pscustomobject]@{
            CapturedAt = Get-Date -Format "o"
            RootProcessId = $RootProcessId
            ProcessId = $processId
            ParentProcessId = if ($cim) { [int]$cim.ParentProcessId } else { $null }
            Name = if ($cim) { $cim.Name } else { $runtime.ProcessName }
            CpuSeconds = if ($runtime) { [math]::Round($runtime.CPU, 3) } else { $null }
            WorkingSet = if ($runtime) { $runtime.WorkingSet64 } else { $null }
            StartTime = if ($runtime) { $runtime.StartTime.ToString("o") } else { $null }
            CommandLine = if ($cim) { $cim.CommandLine } else { $null }
        }
    }
}
```

### 9.2 Install exact-tree termination helper

```powershell
function Stop-ExactProcessTree {
    param(
        [int]$RootProcessId,
        [string]$EvidenceDirectory
    )

    $preTermination = @(Get-ProcessTreeSnapshot -RootProcessId $RootProcessId)
    $preTermination |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath (
            Join-Path $EvidenceDirectory "process-tree-before-termination.json"
        )

    & taskkill.exe /PID $RootProcessId /T /F | Tee-Object -FilePath (
        Join-Path $EvidenceDirectory "taskkill.txt"
    )

    Start-Sleep -Seconds 3

    $remaining = @(
        $preTermination |
            Where-Object {
                Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            }
    )

    $remaining |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath (
            Join-Path $EvidenceDirectory "process-tree-after-termination.json"
        )

    Assert-Equal 0 $remaining.Count "Exact test process tree is terminated"
}
```

### 9.3 Install the monitored Node-test runner

```powershell
function Invoke-MonitoredNodeTest {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string[]]$NodeArguments,
        [ValidateSet("0", "1")] [string]$SessionMode,
        [int]$TimeoutSeconds = 900,
        [switch]$EnableTrace
    )

    $runDirectory = Join-Path $investigationRoot $Name
    if (Test-Path -LiteralPath $runDirectory) {
        throw "Run directory already exists: $runDirectory"
    }
    New-Item -ItemType Directory -Path $runDirectory | Out-Null

    $stdoutPath = Join-Path $runDirectory "stdout.log"
    $stderrPath = Join-Path $runDirectory "stderr.log"
    $snapshotPath = Join-Path $runDirectory "process-snapshots.csv"
    $gitTracePath = Join-Path $runDirectory "git-trace2.json"
    $startedAt = Get-Date
    $deadline = $startedAt.AddSeconds($TimeoutSeconds)
    $timedOut = $false

    $fixturesBefore = @(
        Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "vcs-lab-test-*" |
            Select-Object -ExpandProperty FullName
    )
    $observedFixtures = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    $previousEnvironment = @{
        VLAB_GIT_SESSION = [Environment]::GetEnvironmentVariable(
            "VLAB_GIT_SESSION",
            "Process"
        )
        VLAB_TRACE = [Environment]::GetEnvironmentVariable("VLAB_TRACE", "Process")
        GIT_TRACE2_EVENT = [Environment]::GetEnvironmentVariable(
            "GIT_TRACE2_EVENT",
            "Process"
        )
    }

    try {
        $env:VLAB_GIT_SESSION = $SessionMode
        if ($EnableTrace) {
            $env:VLAB_TRACE = "1"
            $env:GIT_TRACE2_EVENT = $gitTracePath
        }
        else {
            Remove-Item Env:VLAB_TRACE -ErrorAction SilentlyContinue
            Remove-Item Env:GIT_TRACE2_EVENT -ErrorAction SilentlyContinue
        }

        $process = Start-Process `
            -FilePath "node" `
            -ArgumentList $NodeArguments `
            -WorkingDirectory $sourceRepo `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru

        while (-not $process.WaitForExit(5000)) {
            $snapshot = @(Get-ProcessTreeSnapshot -RootProcessId $process.Id)
            $snapshot | Export-Csv -NoTypeInformation -Append -LiteralPath $snapshotPath

            $currentFixtures = @(
                Get-ChildItem `
                    -LiteralPath $env:TEMP `
                    -Directory `
                    -Filter "vcs-lab-test-*" |
                    Select-Object -ExpandProperty FullName
            )
            foreach ($fixture in $currentFixtures) {
                if ($fixturesBefore -notcontains $fixture) {
                    $null = $observedFixtures.Add($fixture)
                }
            }

            $stdoutInfo = Get-Item -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
            $stderrInfo = Get-Item -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            $lastOutputInfo = @($stdoutInfo, $stderrInfo) |
                Where-Object { $null -ne $_ } |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            $elapsed = (Get-Date) - $startedAt

            Write-Host (
                "{0}: elapsed={1:n1}s tree={2} stdout={3} stderr={4} last={5}" -f
                    $Name,
                    $elapsed.TotalSeconds,
                    $snapshot.Count,
                    $(if ($stdoutInfo) { $stdoutInfo.Length } else { 0 }),
                    $(if ($stderrInfo) { $stderrInfo.Length } else { 0 }),
                    $(if ($lastOutputInfo) { $lastOutputInfo.LastWriteTime.ToString("o") } else { "none" })
            )

            if ((Get-Date) -ge $deadline) {
                $timedOut = $true
                Stop-ExactProcessTree `
                    -RootProcessId $process.Id `
                    -EvidenceDirectory $runDirectory
                $process.WaitForExit()
                break
            }
        }

        if (-not $timedOut) {
            $process.WaitForExit()
        }
        $exitCode = $process.ExitCode
    }
    finally {
        foreach ($environmentName in $previousEnvironment.Keys) {
            $value = $previousEnvironment[$environmentName]
            if ($null -eq $value) {
                Remove-Item "Env:$environmentName" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item "Env:$environmentName" $value
            }
        }
    }

    $fixturesAfter = @(
        Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "vcs-lab-test-*" |
            Select-Object -ExpandProperty FullName
    )
    foreach ($fixture in $fixturesAfter) {
        if ($fixturesBefore -notcontains $fixture) {
            $null = $observedFixtures.Add($fixture)
        }
    }
    $newFixtures = @($observedFixtures | Sort-Object)
    $newFixtures | Set-Content -LiteralPath (
        Join-Path $runDirectory "new-fixtures.txt"
    )

    $stdout = if (Test-Path -LiteralPath $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath -Raw
    }
    else {
        ""
    }
    $stderr = if (Test-Path -LiteralPath $stderrPath) {
        Get-Content -LiteralPath $stderrPath -Raw
    }
    else {
        ""
    }
    $stdoutText = if ($null -eq $stdout) { "" } else { [string]$stdout }
    $stderrText = if ($null -eq $stderr) { "" } else { [string]$stderr }

    $result = [pscustomobject]@{
        Name = $Name
        SessionMode = $SessionMode
        NodeArguments = $NodeArguments
        StartedAt = $startedAt.ToString("o")
        FinishedAt = (Get-Date).ToString("o")
        ElapsedSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 3)
        TimedOut = $timedOut
        ExitCode = $exitCode
        RootProcessId = $process.Id
        StdoutBytes = [Text.Encoding]::UTF8.GetByteCount($stdoutText)
        StderrBytes = [Text.Encoding]::UTF8.GetByteCount($stderrText)
        ReportedTests = [regex]::Match(
            $stdoutText,
            '(?m)^(?:#|ℹ)\s*tests\s+(\d+)\s*$'
        ).Groups[1].Value
        ReportedPass = [regex]::Match(
            $stdoutText,
            '(?m)^(?:#|ℹ)\s*pass\s+(\d+)\s*$'
        ).Groups[1].Value
        ReportedFail = [regex]::Match(
            $stdoutText,
            '(?m)^(?:#|ℹ)\s*fail\s+(\d+)\s*$'
        ).Groups[1].Value
        NewFixtures = $newFixtures
        EvidenceDirectory = $runDirectory
    }

    $result | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $runDirectory "result.json")
    return $result
}
```

### 9.4 Verify the harness without running the suite

```powershell
$treeProbe = @(Get-ProcessTreeSnapshot -RootProcessId $PID)
Assert-True ($treeProbe.Count -ge 1) "Process-tree capture can inspect the current shell"
Assert-True (
    $treeProbe[0].CommandLine -match "pwsh|powershell"
) "Process-tree capture includes command lines"

$harnessProbe = Invoke-MonitoredNodeTest `
    -Name "harness-probe" `
    -NodeArguments @("--version") `
    -SessionMode "0" `
    -TimeoutSeconds 30

Assert-True (-not $harnessProbe.TimedOut) "Harness probe does not time out"
Assert-Equal 0 $harnessProbe.ExitCode "Harness probe exits successfully"
Assert-Equal 0 $harnessProbe.NewFixtures.Count "Harness probe creates no test fixture"
Assert-Equal "harness-probe" $harnessProbe.Name "Harness preserves the case name"
```

## 10. FS-03 — Targeted ordinary control

Run only the test localized by the failed evidence, with the persistent session
disabled:

```powershell
$targetArguments = @(
    "--test",
    "--test-name-pattern=exact.*conflict.*resolutions.*reused",
    "test\integration.test.js"
)

$targetOrdinary = Invoke-MonitoredNodeTest `
    -Name "target-ordinary-01" `
    -NodeArguments $targetArguments `
    -SessionMode "0" `
    -TimeoutSeconds 300 `
    -EnableTrace

Assert-True (-not $targetOrdinary.TimedOut) "Target ordinary control completes"
Assert-Equal 0 $targetOrdinary.ExitCode "Target ordinary control exits successfully"
Assert-Equal "1" $targetOrdinary.ReportedTests "Target ordinary control reports one selected test"
Assert-Equal "1" $targetOrdinary.ReportedPass "Target ordinary control reports one pass"
Assert-Equal "0" $targetOrdinary.ReportedFail "Target ordinary control reports zero failures"
```

If this fails, stop. The defect is not specific to the persistent session.

## 11. FS-04 — Targeted forced direct-console control

This case distinguishes direct console execution from the redirected monitor.
Run it ten times. It intentionally displays output in the current console while
retaining a five-minute exact-process-tree deadline.

```powershell
$targetDirectResults = @()
$previousDirectEnvironment = @{
    VLAB_GIT_SESSION = [Environment]::GetEnvironmentVariable(
        "VLAB_GIT_SESSION",
        "Process"
    )
    VLAB_TRACE = [Environment]::GetEnvironmentVariable("VLAB_TRACE", "Process")
}

foreach ($iteration in 1..10) {
    $name = "target-direct-{0:d2}" -f $iteration
    $runDirectory = Join-Path $investigationRoot $name
    New-Item -ItemType Directory -Path $runDirectory | Out-Null

    $env:VLAB_GIT_SESSION = "1"
    $env:VLAB_TRACE = "1"
    $directTimedOut = $false
    try {
        $started = Get-Date
        $deadline = $started.AddMinutes(5)
        $process = Start-Process `
            -FilePath "node" `
            -ArgumentList $targetArguments `
            -WorkingDirectory $sourceRepo `
            -NoNewWindow `
            -PassThru

        while (-not $process.WaitForExit(5000)) {
            $snapshot = @(Get-ProcessTreeSnapshot -RootProcessId $process.Id)
            $snapshot |
                Export-Csv `
                    -NoTypeInformation `
                    -Append `
                    -LiteralPath (Join-Path $runDirectory "process-snapshots.csv")

            Write-Host (
                "{0}: elapsed={1:n1}s tree={2}" -f
                    $name,
                    ((Get-Date) - $started).TotalSeconds,
                    $snapshot.Count
            )

            if ((Get-Date) -ge $deadline) {
                $directTimedOut = $true
                Stop-ExactProcessTree `
                    -RootProcessId $process.Id `
                    -EvidenceDirectory $runDirectory
                $process.WaitForExit()
                break
            }
        }

        if (-not $directTimedOut) {
            $process.WaitForExit()
        }
        $exitCode = $process.ExitCode
        $elapsed = (Get-Date) - $started
    }
    finally {
        foreach ($environmentName in $previousDirectEnvironment.Keys) {
            $value = $previousDirectEnvironment[$environmentName]
            if ($null -eq $value) {
                Remove-Item "Env:$environmentName" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item "Env:$environmentName" $value
            }
        }
    }

    $item = [pscustomobject]@{
        Iteration = $iteration
        TimedOut = $directTimedOut
        ExitCode = $exitCode
        ElapsedSeconds = [math]::Round($elapsed.TotalSeconds, 3)
        EvidenceDirectory = $runDirectory
    }
    $targetDirectResults += $item
    $item | Format-List

    if ($directTimedOut -or $exitCode -ne 0) {
        throw "Direct-console target failed at iteration $iteration."
    }
}

$targetDirectResults |
    Export-Csv -NoTypeInformation -LiteralPath (
        Join-Path $investigationRoot "target-direct-results.csv"
    )
```

Stop and retain the investigation root if any direct-console iteration times
out or exits nonzero.

## 12. FS-05 — Targeted forced redirected stress

Run 20 monitored iterations. Stop on the first failure and preserve it.

```powershell
$targetForcedResults = @()

foreach ($iteration in 1..20) {
    $name = "target-forced-{0:d2}" -f $iteration
    $result = Invoke-MonitoredNodeTest `
        -Name $name `
        -NodeArguments $targetArguments `
        -SessionMode "1" `
        -TimeoutSeconds 300 `
        -EnableTrace

    $targetForcedResults += $result

    if (
        $result.TimedOut -or
        $result.ExitCode -ne 0 -or
        $result.ReportedTests -ne "1" -or
        $result.ReportedPass -ne "1" -or
        $result.ReportedFail -ne "0"
    ) {
        $targetForcedResults |
            ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath (
                Join-Path $investigationRoot "target-forced-results.json"
            )
        throw "Targeted forced run failed: $name"
    }
}

$targetForcedResults |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $investigationRoot "target-forced-results.json"
    )

Assert-Equal 20 $targetForcedResults.Count "Twenty targeted forced runs complete"
```

## 13. FS-06 — Complete forced redirected suite

Run the full suite three times only after all targeted cases pass:

```powershell
$fullArguments = @("--test")
$fullForcedResults = @()

foreach ($iteration in 1..3) {
    $name = "full-forced-{0:d2}" -f $iteration
    $result = Invoke-MonitoredNodeTest `
        -Name $name `
        -NodeArguments $fullArguments `
        -SessionMode "1" `
        -TimeoutSeconds 900 `
        -EnableTrace

    $fullForcedResults += $result

    $valid = (
        -not $result.TimedOut -and
        $result.ExitCode -eq 0 -and
        $result.ReportedTests -eq "43" -and
        $result.ReportedPass -eq "43" -and
        $result.ReportedFail -eq "0"
    )

    if (-not $valid) {
        $fullForcedResults |
            ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath (
                Join-Path $investigationRoot "full-forced-results.json"
            )
        throw "Complete forced run failed: $name"
    }
}

$fullForcedResults |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $investigationRoot "full-forced-results.json"
    )

Assert-Equal 3 $fullForcedResults.Count "Three complete forced runs pass"
```

Then run one complete ordinary control through the same redirected harness:

```powershell
$fullOrdinary = Invoke-MonitoredNodeTest `
    -Name "full-ordinary-01" `
    -NodeArguments $fullArguments `
    -SessionMode "0" `
    -TimeoutSeconds 900

Assert-True (-not $fullOrdinary.TimedOut) "Complete ordinary suite finishes"
Assert-Equal 0 $fullOrdinary.ExitCode "Complete ordinary suite exits successfully"
Assert-Equal "43" $fullOrdinary.ReportedTests "Ordinary suite reports 43 tests"
Assert-Equal "43" $fullOrdinary.ReportedPass "Ordinary suite reports 43 passes"
Assert-Equal "0" $fullOrdinary.ReportedFail "Ordinary suite reports zero failures"
```

## 14. FS-07 — Node-version matrix

The package supports Node.js 20 or later. At minimum, repeat one targeted forced
run and one complete forced run on:

- Node.js 20 LTS; and
- the current development Node version.

After changing Node versions with the operator’s installed version manager, run:

```powershell
node --version
npm --version
git --version

$matrixNodeVersion = node --version
$matrixSafeVersion = $matrixNodeVersion -replace '[^0-9A-Za-z.-]', '_'

$matrixTarget = Invoke-MonitoredNodeTest `
    -Name "matrix-$matrixSafeVersion-target" `
    -NodeArguments $targetArguments `
    -SessionMode "1" `
    -TimeoutSeconds 300 `
    -EnableTrace

$matrixFull = Invoke-MonitoredNodeTest `
    -Name "matrix-$matrixSafeVersion-full" `
    -NodeArguments $fullArguments `
    -SessionMode "1" `
    -TimeoutSeconds 900

Assert-True (-not $matrixTarget.TimedOut) "$matrixNodeVersion target completes"
Assert-Equal 0 $matrixTarget.ExitCode "$matrixNodeVersion target passes"
Assert-Equal "1" $matrixTarget.ReportedPass "$matrixNodeVersion target reports one pass"
Assert-True (-not $matrixFull.TimedOut) "$matrixNodeVersion full suite completes"
Assert-Equal 0 $matrixFull.ExitCode "$matrixNodeVersion full suite passes"
Assert-Equal "43" $matrixFull.ReportedPass "$matrixNodeVersion reports 43 passes"
```

Record the version-manager command separately in the transcript. Do not install
or replace Node during an active test run.

## 15. FS-08 — Failure analysis

Run this section only after a timeout or unexpected nonzero exit. Do not clean
the investigation root.

### 15.1 Identify the last output and process state

```powershell
$failedRun = Get-ChildItem -LiteralPath $investigationRoot -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Get-ChildItem -LiteralPath $failedRun.FullName -Force |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize

Get-Content -LiteralPath (Join-Path $failedRun.FullName "stdout.log") -Tail 120
Get-Content -LiteralPath (Join-Path $failedRun.FullName "stderr.log") -Tail 120

$snapshots = Import-Csv -LiteralPath (
    Join-Path $failedRun.FullName "process-snapshots.csv"
)
$snapshots |
    Sort-Object CapturedAt, ProcessId |
    Select-Object -Last 100 |
    Format-Table -AutoSize
```

### 15.2 Inspect retained fixture repositories

```powershell
$global:vlabCli = (Resolve-Path (Join-Path $sourceRepo "bin\vlab.js")).Path

$fixtureListPath = Join-Path $failedRun.FullName "new-fixtures.txt"
$failedFixtures = @(
    Get-Content -LiteralPath $fixtureListPath -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath $_ }
)

foreach ($fixture in $failedFixtures) {
    Write-Host "Fixture: $fixture"
    Get-ChildItem -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*.lock" } |
        Select-Object FullName, Length, LastWriteTime |
        Format-Table -AutoSize

    $repos = @(
        Get-ChildItem -LiteralPath $fixture -Directory -Recurse -Force |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName ".git") }
    )

    foreach ($repo in $repos) {
        Push-Location $repo.FullName
        try {
            git status --short --branch
            git worktree list --porcelain
            node $global:vlabCli reconcile --status --json
            node $global:vlabCli resolve status --json
        }
        finally {
            Pop-Location
        }
    }
}
```

### 15.3 Correlate the localized source path

```powershell
Set-Location $sourceRepo

rg -n -C 12 `
    "exact conflict resolutions are suggested and reused|reconcile.*source-one" `
    test\integration.test.js

rg -n -C 10 `
    "class GitObjectSession|close\(\)|disable\(\)|closeGitSession|Atomics.wait" `
    src\git.js src\git-session-worker.js
```

Capture the exact last VCS Lab command and the deepest surviving child command
line in the defect report. Do not infer the blocked command from parent CPU
alone.

## 16. FS-09 — Static and process-leak gates

### 16.1 JavaScript and whitespace

```powershell
Set-Location $sourceRepo

$syntaxFailed = $false
rg --files src bin test scripts |
    Where-Object { $_ -like "*.js" -or $_ -like "*.mjs" } |
    ForEach-Object {
        node --check $_
        if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true }
    }

Assert-True (-not $syntaxFailed) "JavaScript syntax passes"

git diff --check
Assert-Equal 0 $LASTEXITCODE "Whitespace validation passes"
```

### 16.2 Leak audit

```powershell
Start-Sleep -Seconds 5

$newNodeProcesses = @(
    Get-Process node -ErrorAction SilentlyContinue |
        Where-Object { $baselineNodeIds -notcontains $_.Id }
)
$newGitProcesses = @(
    Get-Process git -ErrorAction SilentlyContinue |
        Where-Object { $baselineGitIds -notcontains $_.Id }
)

$newNodeProcesses |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize
$newGitProcesses |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize

Assert-Equal 0 $newNodeProcesses.Count "No new Node process remains"
Assert-Equal 0 $newGitProcesses.Count "No new Git process remains"
Assert-Equal $sourceHeadAtStart (git rev-parse HEAD) "Source HEAD is preserved"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Source remains clean"
```

If an unrelated application started Node or Git during the run, capture its
command line and document why it is unrelated before accepting the leak gate.

## 17. FS-10 — Full development qualification

Only after the correction exit criteria pass:

```powershell
Set-Location $sourceRepo

Write-Host "Focused correction gate passed. Begin TEST_PLAN.md revision 2."
Write-Host "Run TP-01 through TP-18 in a new PowerShell window."
Write-Host "Run TP-19 only when release-candidate artifacts exist."
```

The complete plan must begin from a clean committed source checkout. Record its
result in a new result document; do not overwrite either historical failure.

## 18. Failure disposition

At the first failure:

```powershell
$failureRecord = [pscustomobject]@{
    FailedAt = Get-Date -Format "o"
    SourceCommit = git -C $sourceRepo rev-parse HEAD
    SourceStatus = (git -C $sourceRepo status --porcelain=v1) -join "`n"
    InvestigationRoot = $investigationRoot
    Transcript = $transcript
}

$failureRecord | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $investigationRoot "failure.json")
$failureRecord | Format-List

Stop-Transcript
```

Then:

- retain the entire investigation root;
- retain any surviving `vcs-lab-test-*` fixture;
- do not run further stress iterations;
- do not run `TEST_PLAN.md` cleanup; and
- open or update the forced-session lifecycle defect with the evidence paths.

## 19. Successful cleanup

Run only after all correction gates have passed and evidence has been copied to
its reviewed retention location.

```powershell
Stop-Transcript

$resolvedInvestigationRoot = [System.IO.Path]::GetFullPath($investigationRoot)
$resolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP)

Assert-True (
    $resolvedInvestigationRoot.StartsWith(
        $resolvedTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    )
) "Cleanup target is inside the system temporary directory"

Assert-True (
    (Split-Path $resolvedInvestigationRoot -Leaf) -like
        "vcs-lab-session-investigation-*"
) "Cleanup target has the expected investigation name"

Write-Host "Validated cleanup target: $resolvedInvestigationRoot"
Remove-Item -LiteralPath $resolvedInvestigationRoot -Recurse -Force

Assert-True (
    -not (Test-Path -LiteralPath $resolvedInvestigationRoot)
) "Investigation root is removed"
```

## 20. Result template

```text
Forced Git-session investigation
================================
Date/time:
Operator:
Computer:
PowerShell:
Node versions:
Git:
Branch:
Commit:
Investigation root:
Transcript:

FS-01 Baseline/evidence: PASS / FAIL
FS-02 Harness: PASS / FAIL
FS-03 Target ordinary: PASS / FAIL
FS-04 Target forced direct: PASS / FAIL (x/10)
FS-05 Target forced redirected: PASS / FAIL (x/20)
FS-06 Full forced redirected: PASS / FAIL (x/3)
FS-07 Node matrix: PASS / FAIL
FS-08 Failure analysis: COMPLETE / NOT REQUIRED
FS-09 Static/leak gates: PASS / FAIL
FS-10 Full TEST_PLAN rerun: PASS / FAIL / NOT STARTED

First failing iteration:
Last output time:
Last output line:
Root PID:
Deepest surviving child PID and command:
Localized test:
Localized VCS Lab/Git operation:
Forced termination required: YES / NO
Retained fixture paths:

Final focused-gate result: PASS / FAIL
Full development-gate result: PASS / FAIL / NOT RUN
Open defects:
Retained evidence:
```
