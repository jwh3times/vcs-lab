# VCS Lab Full Test Plan

## 1. Document control

| Field | Value |
| --- | --- |
| Product | causal-vcs-lab |
| Test-plan revision | 2 |
| Prepared | 2026-08-23 |
| Consolidated development branch | `main` |
| Implementation baseline commit | `1e91d08` |
| Released package version at this baseline | `0.8.0` |
| Development track | v0.9 supervised linear causal rebase |
| Primary platform | Windows, PowerShell 7, Node.js 20+, Git |

This plan is the operator-facing validation procedure for the current
development baseline. It complements [PRD.md](PRD.md),
[ARCHITECTURE.md](ARCHITECTURE.md),
[ADR-0011](docs/adr/0011-model-causal-rebase-as-a-forecasted-application-sequence.md),
and [SESSION_HANDOFF.md](SESSION_HANDOFF.md).

Revision 2 incorporates the 2026-08-22 execution findings: TP-04 now uses a
bounded monitored runner that accommodates buffered Node test output, and every
fresh clone applies LF configuration before its initial checkout.

## 2. Purpose

The plan validates:

- repository and documentation hygiene;
- behavior equality with ordinary Git plumbing and the persistent object
  session;
- all maintained demonstrations;
- deterministic causal rebase planning and forecasting;
- supervised current-branch application;
- stable and explicitly forked logical identity;
- worktree-private conflict recovery and exact abort;
- fail-closed stale, empty, heuristic, and unsupported-topology boundaries;
- exact resolution reuse;
- validated rebase application/summary records;
- deterministic metadata export;
- fresh-clone transport of original commits made unreachable by rewrite;
- idempotent import and tamper-safe rejection; and
- process cleanup on Windows.

Passing this laboratory plan is not a production-readiness claim. Threat
modeling, fuzzing, generalized crash injection, remote interoperability,
performance service-level objectives, and a support policy remain separate.

## 3. Safety rules

1. Run source-checkout gates only in the named `vcs-lab` checkout.
2. Run every history-changing case only in the timestamped directory created
   under `$env:TEMP`.
3. Do not run manual rebase cases directly in `apexracers` or another valuable
   repository.
4. Stop at the first unexpected failure and retain the temporary repositories
   and transcript.
5. Do not use `git reset --hard` manually for recovery. Capture status and use
   `vlab rebase --continue`, `--continue --fork`, or `--abort`.
6. Validate an absolute cleanup target before any recursive deletion.
7. Expected nonzero commands are explicitly labeled. Any other nonzero exit is
   a failure.
8. A sandbox warning about the global Git ignore file is environmental noise
   when the asserted command still exits successfully.

## 4. Entry criteria

- PowerShell 7, Node.js 20 or later, and Git are available.
- The repository exists at
  `C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab`.
- Implementation baseline commit `1e91d08` is available locally.
- The source worktree is clean.
- No manual Git replay is active in the source worktree.
- The system temporary directory has space for disposable clones and bundles.

## 5. Exit criteria

The development gate passes only when:

1. the source checkout begins and ends clean at the same commit, which contains
   implementation baseline `1e91d08`;
2. 43/43 tests pass with the persistent session disabled;
3. 43/43 tests pass with the persistent session forced;
4. all six maintained demos exit successfully;
5. syntax, whitespace, Markdown-link, and requirement-ID checks pass;
6. every mandatory manual acceptance case passes;
7. metadata validation reports no errors after completed workflows;
8. intentional failures do not mutate protected branch/ref state;
9. no VCS Lab Node/Git process remains after the shutdown grace period; and
10. the transcript and evidence paths are recorded.

## 6. Test inventory

| ID | Test | Mandatory |
| --- | --- | --- |
| TP-01 | Bootstrap, tools, and evidence capture | Yes |
| TP-02 | Source checkout and version verification | Yes |
| TP-03 | Ordinary-mode integration suite | Yes |
| TP-04 | Forced-session integration suite | Yes |
| TP-05 | Static repository gates | Yes |
| TP-06 | Maintained demos and session comparison | Yes |
| TP-07 | Read-only consumer-repository smoke | Recommended |
| TP-08 | Deterministic plan/forecast and clean reviewed rebase | Yes |
| TP-09 | Deterministic envelope, fresh-clone import, idempotence | Yes |
| TP-10 | Tampered-envelope rejection | Yes |
| TP-11 | Stale forecast rejection | Yes |
| TP-12 | Conflict isolation and explicit fork | Yes |
| TP-13 | Exact abort after partial replay | Yes |
| TP-14 | Unexpectedly empty replay | Yes |
| TP-15 | Exact resolution reuse | Yes |
| TP-16 | Heuristic candidate policy | Yes |
| TP-17 | Linear-v1 merge-topology rejection | Yes |
| TP-18 | Final process/source/evidence audit | Yes |
| TP-19 | Release-artifact verification | Conditional |
| TP-20 | Safe cleanup | After complete success |

## 7. TP-01 — Bootstrap, tools, and evidence capture

### Objective

Create an isolated test root, start a transcript, install helpers, and record
the pre-test Node/Git process baseline.

### Commands

Open a new PowerShell 7 window:

```powershell
$sourceRepo = "C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab"
Set-Location $sourceRepo

$global:vlabCli = (Resolve-Path ".\bin\vlab.js").Path
$implementationBaseline = "1e91d08"
$expectedBranch = "main"
$sourceHeadAtStart = git rev-parse HEAD
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$uatRoot = Join-Path $env:TEMP "vcs-lab-uat-$stamp"
$transcript = Join-Path $env:TEMP "vcs-lab-uat-$stamp.log"

New-Item -ItemType Directory -Path $uatRoot | Out-Null
Start-Transcript -LiteralPath $transcript
```

Install helpers:

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

function Assert-JsonEqual {
    param($Expected, $Actual, [string]$Label)
    $expectedJson = $Expected | ConvertTo-Json -Depth 30 -Compress
    $actualJson = $Actual | ConvertTo-Json -Depth 30 -Compress
    if ($expectedJson -cne $actualJson) {
        throw "ASSERTION FAILED: $Label`nExpected: $expectedJson`nActual:   $actualJson"
    }
    Write-Host "PASS: $Label" -ForegroundColor Green
}

function Write-Utf8Lf {
    param([string]$Path, [string]$Text)
    $normalized = $Text -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText(
        $Path,
        $normalized,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Invoke-VlabJson {
    param([string]$Repo, [string[]]$VlabArgs)
    Push-Location $Repo
    try {
        $raw = & node $global:vlabCli @VlabArgs
        if ($LASTEXITCODE -ne 0) {
            throw "vlab failed in '$Repo': $($VlabArgs -join ' ')"
        }
        return (($raw -join "`n") | ConvertFrom-Json)
    }
    finally {
        Pop-Location
    }
}

function Invoke-VlabExpectedFailure {
    param([string]$Repo, [string[]]$VlabArgs)
    Push-Location $Repo
    try {
        $output = (& node $global:vlabCli @VlabArgs 2>&1 | Out-String)
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    }
    finally {
        Pop-Location
    }
}

function New-VlabTestRepo {
    param(
        [string]$Path,
        [string]$BaseFile = "base.txt",
        [string]$BaseText = "base`n"
    )

    if (Test-Path -LiteralPath $Path) {
        throw "Test path already exists: $Path"
    }

    & git init -b main $Path | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git init failed: $Path" }

    Push-Location $Path
    try {
        git config user.name "VCS Lab UAT"
        git config user.email "vcs-lab-uat@example.invalid"
        git config core.autocrlf false
        git config core.eol lf

        Write-Utf8Lf -Path (Join-Path $Path $BaseFile) -Text $BaseText
        git add -- $BaseFile

        $base = Invoke-VlabJson -Repo $Path -VlabArgs @(
            "commit", "-m", "UAT base", "--json"
        )

        & node $global:vlabCli init | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "vlab init failed: $Path" }
        return $base
    }
    finally {
        Pop-Location
    }
}
```

Record the environment:

```powershell
$environmentRecord = [pscustomobject]@{
    Date = Get-Date -Format "o"
    Computer = $env:COMPUTERNAME
    PowerShell = $PSVersionTable.PSVersion.ToString()
    Node = (& node --version)
    Git = (& git --version)
    SourceRepo = $sourceRepo
    TestRoot = $uatRoot
    Transcript = $transcript
}

$environmentRecord | Format-List

$baselineProcessIds = @(
    Get-Process node, git -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Id
)

Get-Process node, git -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize
```

### Expected result

- Unique UAT and transcript paths exist under `$env:TEMP`.
- Tool versions print.
- The process baseline is present in the transcript.

## 8. TP-02 — Source checkout and version verification

### Commands

```powershell
Set-Location $sourceRepo

$actualCommit = git rev-parse HEAD
$actualBranch = git branch --show-current
$sourceStatus = (git status --porcelain=v1) -join "`n"

$activeGitStates = @(
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "MERGE_HEAD",
    "REBASE_HEAD"
) | Where-Object {
    git rev-parse --verify --quiet $_ 2>$null
    $LASTEXITCODE -eq 0
}

git status --short --branch
git log -5 --oneline --decorate
node $global:vlabCli version

Assert-Equal $sourceHeadAtStart $actualCommit "Checkout remains at execution-start commit"
Assert-Equal $expectedBranch $actualBranch "Expected development branch"
Assert-Equal "" $sourceStatus "Source worktree is clean"
Assert-Equal 0 $activeGitStates.Count "No native Git replay is active"

git merge-base --is-ancestor $implementationBaseline $actualCommit
$baselineRelationExit = $LASTEXITCODE
Assert-Equal 0 $baselineRelationExit "Checkout contains implementation baseline"

$package = Get-Content package.json -Raw | ConvertFrom-Json
$reportedVersion = (& node $global:vlabCli version) -join "`n"

Assert-Equal "0.8.0" $package.version "Expected package version"
Assert-True ($package.engines.node -match "20") "Node 20+ engine requirement"
Assert-True ($reportedVersion -match "vcs-lab 0.8.0") "CLI version output"
```

### Expected result

Branch `main`, a clean commit containing baseline `1e91d08`, and CLI
version `0.8.0`.

## 9. TP-03 — Ordinary-mode integration suite

The integration suite is contained in one test file, so Node may buffer the
summary until the file exits. A passing sandboxed Windows run has taken about
250 seconds. Allow up to 12 minutes and do not classify absent TAP output alone
as a stall; use process activity and the final exit code.

### Commands

```powershell
Set-Location $sourceRepo

$env:VLAB_GIT_SESSION = "0"
$ordinaryStarted = Get-Date
npm test
$ordinaryExit = $LASTEXITCODE
$ordinaryElapsed = (Get-Date) - $ordinaryStarted

Assert-Equal 0 $ordinaryExit "Ordinary-mode suite exits successfully"
Write-Host "Ordinary elapsed: $($ordinaryElapsed.TotalSeconds) seconds"
```

### Expected result

```text
tests 43
pass 43
fail 0
```

If it fails:

```powershell
git status --short --branch
Get-Process node, git -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize
```

Stop and retain evidence.

## 10. TP-04 — Forced-session integration suite

The Node test runner executes the single integration file in a child process and
may buffer its test summary until that file exits. On the reference Windows
host, a passing forced-session run took approximately 250 seconds. Lack of TAP
output during that interval is not by itself a stall. The monitored command
below allows 12 minutes, reports the parent process every 15 seconds, captures
both output streams, and terminates only the exact test-process tree if the
deadline expires.

### Commands

```powershell
Set-Location $sourceRepo

$forcedStdout = Join-Path $uatRoot "forced-session.stdout.log"
$forcedStderr = Join-Path $uatRoot "forced-session.stderr.log"
$forcedTimeout = [TimeSpan]::FromMinutes(12)
$forcedTimedOut = $false

$env:VLAB_GIT_SESSION = "1"
$sessionStarted = Get-Date
try {
    $testProcess = Start-Process `
        -FilePath "node" `
        -ArgumentList @("--test") `
        -WorkingDirectory $sourceRepo `
        -RedirectStandardOutput $forcedStdout `
        -RedirectStandardError $forcedStderr `
        -WindowStyle Hidden `
        -PassThru

    while (-not $testProcess.WaitForExit(15000)) {
        $testProcess.Refresh()
        $elapsed = (Get-Date) - $sessionStarted
        $processSnapshot = Get-Process -Id $testProcess.Id -ErrorAction SilentlyContinue
        $cpu = if ($processSnapshot) {
            [math]::Round($processSnapshot.CPU, 2)
        }
        else {
            $null
        }

        Write-Host (
            "Forced suite active: pid={0}, elapsed={1:n1}s, cpu={2}" -f
                $testProcess.Id,
                $elapsed.TotalSeconds,
                $cpu
        )

        if ($elapsed -ge $forcedTimeout) {
            $forcedTimedOut = $true
            Write-Host "Forced suite exceeded $($forcedTimeout.TotalMinutes) minutes."
            & taskkill.exe /PID $testProcess.Id /T /F | Out-Host
            $testProcess.WaitForExit()
            break
        }
    }

    if (-not $forcedTimedOut) {
        $testProcess.WaitForExit()
    }
    $sessionExit = $testProcess.ExitCode
}
finally {
    Remove-Item Env:VLAB_GIT_SESSION -ErrorAction SilentlyContinue
}
$sessionElapsed = (Get-Date) - $sessionStarted

$forcedOutput = if (Test-Path -LiteralPath $forcedStdout) {
    Get-Content -LiteralPath $forcedStdout -Raw
}
else {
    ""
}
$forcedErrors = if (Test-Path -LiteralPath $forcedStderr) {
    Get-Content -LiteralPath $forcedStderr -Raw
}
else {
    ""
}

$forcedOutput | Write-Host
if ($forcedErrors) { $forcedErrors | Write-Host }

Assert-True (-not $forcedTimedOut) "Forced-session suite completes before deadline"
Assert-Equal 0 $sessionExit "Forced-session suite exits successfully"
Assert-True (
    $forcedOutput -match '(?m)^(?:#|ℹ)\s*tests\s+43\s*$'
) "Forced-session suite reports 43 tests"
Assert-True (
    $forcedOutput -match '(?m)^(?:#|ℹ)\s*pass\s+43\s*$'
) "Forced-session suite reports 43 passes"
Assert-True (
    $forcedOutput -match '(?m)^(?:#|ℹ)\s*fail\s+0\s*$'
) "Forced-session suite reports zero failures"
Write-Host "Forced-session elapsed: $($sessionElapsed.TotalSeconds) seconds"

Start-Sleep -Seconds 3

Get-Process node, git -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize
```

### Expected result

The monitored process exits before 12 minutes, 43 tests pass, zero fail, and no
VCS Lab-created worker remains. Retain both forced-session log files as evidence.

## 11. TP-05 — Static repository gates

### 11.1 JavaScript syntax

```powershell
Set-Location $sourceRepo
$syntaxFailed = $false

rg --files src bin test scripts |
    Where-Object { $_ -like "*.js" -or $_ -like "*.mjs" } |
    ForEach-Object {
        node --check $_
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Syntax failure: $_" -ForegroundColor Red
            $syntaxFailed = $true
        }
    }

Assert-True (-not $syntaxFailed) "JavaScript syntax checks pass"
```

### 11.2 Whitespace

```powershell
Set-Location $sourceRepo
git diff --check
Assert-Equal 0 $LASTEXITCODE "Git whitespace check passes"
```

### 11.3 Markdown local links

```powershell
Set-Location $sourceRepo
$badLinks = @()
$markdownFiles = Get-ChildItem -Path . -Recurse -Filter *.md -File

foreach ($file in $markdownFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    $prose = [regex]::Replace($content, '(?ms)^```.*?^```\s*', '')
    foreach ($match in [regex]::Matches($prose, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim()
        if ($target.StartsWith("<") -and $target.EndsWith(">")) {
            $target = $target.Substring(1, $target.Length - 2)
        }
        if ($target -match '^(https?://|mailto:|#)') { continue }
        $pathPart = ($target -split '#', 2)[0]
        if (-not $pathPart) { continue }
        $resolved = Join-Path $file.DirectoryName $pathPart
        if (-not (Test-Path -LiteralPath $resolved)) {
            $badLinks += "$($file.FullName): $target"
        }
    }
}

if ($badLinks.Count -gt 0) { $badLinks }
Assert-Equal 0 $badLinks.Count "Markdown local links resolve"
Write-Host "Markdown files checked: $($markdownFiles.Count)"
```

### 11.4 Requirement IDs

```powershell
Set-Location $sourceRepo
$prd = Get-Content -LiteralPath PRD.md -Raw

$definitions = @(
    [regex]::Matches(
        $prd,
        '(?m)^\|\s*((?:FR|NFR)-[A-Z]+-\d{2})\s*\|'
    ) | ForEach-Object { $_.Groups[1].Value }
)

$duplicates = @(
    $definitions | Group-Object | Where-Object Count -gt 1
)

$known = @{}
$definitions | ForEach-Object { $known[$_] = $true }

$references = @(
    Get-ChildItem -Path . -Recurse -Filter *.md -File |
        ForEach-Object {
            $content = Get-Content -LiteralPath $_.FullName -Raw
            $prose = [regex]::Replace($content, '(?ms)^```.*?^```\s*', '')
            [regex]::Matches($prose, '(?:FR|NFR)-[A-Z]+-\d{2}') |
                ForEach-Object { $_.Value }
        } |
        Sort-Object -Unique
)

$unknown = @(
    $references | Where-Object { -not $known.ContainsKey($_) }
)

if ($duplicates.Count -gt 0) { $duplicates | Format-Table -AutoSize }
if ($unknown.Count -gt 0) { $unknown }

Assert-Equal 0 $duplicates.Count "No duplicate requirement IDs"
Assert-Equal 0 $unknown.Count "No unknown requirement references"
Assert-Equal 128 $definitions.Count "Expected formal FR/NFR count"
```

### 11.5 Cleanliness

```powershell
Set-Location $sourceRepo
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Static gates leave source clean"
Assert-Equal $sourceHeadAtStart (git rev-parse HEAD) "Static gates preserve source commit"
```

## 12. TP-06 — Maintained demos and session comparison

### Commands

```powershell
Set-Location $sourceRepo

npm run demo
Assert-Equal 0 $LASTEXITCODE "General demo"

npm run demo:conflict
Assert-Equal 0 $LASTEXITCODE "Conflict demo"

npm run demo:resolution
Assert-Equal 0 $LASTEXITCODE "Resolution demo"

npm run demo:forecast
Assert-Equal 0 $LASTEXITCODE "Forecast demo"

npm run demo:spec
Assert-Equal 0 $LASTEXITCODE "Specification demo"

npm run demo:git-session
Assert-Equal 0 $LASTEXITCODE "Git-session demo"

node $global:vlabCli doctor --benchmark --samples 10 --warmup 2
Assert-Equal 0 $LASTEXITCODE "Doctor benchmark"
```

### Evidence

Record demo paths, logical queries, session/ordinary process counts, process
reduction, and doctor median/p95 figures. Semantic equality and lower process
count are acceptance invariants; exact wall time is not.

## 13. TP-07 — Optional read-only consumer smoke

### Commands

```powershell
$consumerRepo = "C:\Users\jerry\OneDrive\Documents\VSCodeProjects\apexracers"

if (-not (Test-Path -LiteralPath $consumerRepo)) {
    Write-Host "SKIP TP-07: consumer repository not found"
}
else {
    Set-Location $consumerRepo
    $consumerStatusBefore = (git status --porcelain=v1) -join "`n"
    Assert-Equal "" $consumerStatusBefore "Consumer is initially clean"

    $consumerHeadBefore = git rev-parse HEAD
    $consumerRefsBefore = (
        git for-each-ref `
            --format="%(refname) %(objectname)" `
            refs/notes/vcs-lab refs/vcs-lab
    ) -join "`n"

    $consumerStatus = Invoke-VlabJson $consumerRepo @(
        "metadata", "status", "--json"
    )
    $consumerValidation = Invoke-VlabJson $consumerRepo @(
        "metadata", "validate", "--json"
    )

    $consumerRefsAfter = (
        git for-each-ref `
            --format="%(refname) %(objectname)" `
            refs/notes/vcs-lab refs/vcs-lab
    ) -join "`n"

    Assert-True $consumerStatus.summary.valid "Consumer status is valid"
    Assert-True $consumerValidation.summary.valid "Consumer validation is valid"
    Assert-Equal $consumerHeadBefore (git rev-parse HEAD) "Read-only smoke preserves HEAD"
    Assert-Equal $consumerRefsBefore $consumerRefsAfter "Read-only smoke preserves refs"
    Assert-Equal $consumerStatusBefore ((git status --porcelain=v1) -join "`n") "Read-only smoke preserves status"
}
```

## 14. Manual acceptance-test boundary

All remaining repositories must be children of the previously created
`$uatRoot`. Confirm before proceeding:

```powershell
$resolvedUatRoot = [System.IO.Path]::GetFullPath($uatRoot)
$resolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP)

Assert-True (
    $resolvedUatRoot.StartsWith(
        $resolvedTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    )
) "UAT root is inside the system temporary directory"

Assert-True (
    (Split-Path $resolvedUatRoot -Leaf) -like "vcs-lab-uat-*"
) "UAT root has the expected name"
```

## 15. TP-08 — Deterministic plan/forecast and clean reviewed rebase

### Objective

Prove that hard-squashed work is omitted by exact causal coverage, only the
continuation is replayed, repeated planning/forecasting is deterministic, caller
drafts are preserved, application reproduces the forecast, and stable identity
survives rewrite.

### 15.1 Create the disposable history

```powershell
$cleanRepo = Join-Path $uatRoot "clean-rebase"
$base = New-VlabTestRepo -Path $cleanRepo

Set-Location $cleanRepo
git switch -c feature $base.commit

Write-Utf8Lf "$cleanRepo\feature.txt" "one`n"
git add -- feature.txt
$first = Invoke-VlabJson $cleanRepo @(
    "commit", "-m", "feature one", "--json"
)

Write-Utf8Lf "$cleanRepo\feature.txt" "one`ntwo`n"
git add -- feature.txt
$second = Invoke-VlabJson $cleanRepo @(
    "commit", "-m", "feature two", "--json"
)

git switch main
$landing = Invoke-VlabJson $cleanRepo @(
    "hard-squash", "feature", "--json"
)

git switch feature
Write-Utf8Lf "$cleanRepo\continuation.txt" "three`n"
git add -- continuation.txt
$continuation = Invoke-VlabJson $cleanRepo @(
    "commit", "-m", "feature continuation", "--json"
)

$originalFeatureHead = git rev-parse HEAD
$originalFeatureTree = git rev-parse "HEAD^{tree}"

Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Clean-rebase fixture is clean"
```

### 15.2 Verify plan determinism and non-mutation

```powershell
Set-Location $cleanRepo
Write-Utf8Lf "$cleanRepo\caller-draft.txt" "uncommitted caller bytes`n"

$callerBefore = [pscustomobject]@{
    Head = git rev-parse HEAD
    Branch = git branch --show-current
    Tree = git rev-parse "HEAD^{tree}"
    Status = (git status --porcelain=v1) -join "`n"
    Worktrees = (git worktree list --porcelain) -join "`n"
    DraftHash = (Get-FileHash "$cleanRepo\caller-draft.txt").Hash
}

$planA = Invoke-VlabJson $cleanRepo @(
    "rebase-plan", "main", "--json"
)
$planB = Invoke-VlabJson $cleanRepo @(
    "rebase-plan", "main", "--json"
)

$callerAfterPlan = [pscustomobject]@{
    Head = git rev-parse HEAD
    Branch = git branch --show-current
    Tree = git rev-parse "HEAD^{tree}"
    Status = (git status --porcelain=v1) -join "`n"
    Worktrees = (git worktree list --porcelain) -join "`n"
    DraftHash = (Get-FileHash "$cleanRepo\caller-draft.txt").Hash
}

Assert-JsonEqual $planA $planB "Repeated rebase plans are deterministic"
Assert-JsonEqual $callerBefore $callerAfterPlan "Planning preserves caller state"
Assert-Equal "vcs-lab.rebase-plan/v1" $planA.schema "Plan schema"
Assert-Equal "linear" $planA.mode "Linear plan mode"
Assert-Equal 2 $planA.counts.covered "Two hard-squashed changes are covered"
Assert-Equal 0 $planA.counts.'candidate-equivalent' "No candidate exists"
Assert-Equal 1 $planA.counts.new "Only continuation is new"
Assert-Equal 2 $planA.omitted.Count "Two changes are omitted"
Assert-Equal 1 $planA.replayQueue.Count "One change is queued"
Assert-Equal $first.changeId $planA.omitted[0].changeId "First ID is omitted"
Assert-Equal $second.changeId $planA.omitted[1].changeId "Second ID is omitted"
Assert-Equal $continuation.changeId $planA.replayQueue[0].changeId "Continuation is replayed"
Assert-True $planA.constraints.supported "Linear plan is supported"
Assert-True $planA.executableWithoutReview "Exact plan is executable"
Assert-True ($planA.fingerprint -match "^[0-9a-f]{64}$") "Plan has SHA-256 fingerprint"
```

### 15.3 Verify forecast determinism and caller preservation

```powershell
$forecastA = Invoke-VlabJson $cleanRepo @(
    "rebase-forecast", "main", "--json"
)
$forecastB = Invoke-VlabJson $cleanRepo @(
    "rebase-forecast", "main", "--json"
)

Set-Location $cleanRepo
$callerAfterForecast = [pscustomobject]@{
    Head = git rev-parse HEAD
    Branch = git branch --show-current
    Tree = git rev-parse "HEAD^{tree}"
    Status = (git status --porcelain=v1) -join "`n"
    Worktrees = (git worktree list --porcelain) -join "`n"
    DraftHash = (Get-FileHash "$cleanRepo\caller-draft.txt").Hash
}

Assert-Equal "vcs-lab.rebase-forecast/v1" $forecastA.schema "Forecast schema"
Assert-Equal "complete" $forecastA.status "Forecast is complete"
Assert-Equal $planA.fingerprint $forecastA.planFingerprint "Forecast pins plan"
Assert-Equal $forecastA.planFingerprint $forecastB.planFingerprint "Repeated forecasts pin same plan"
Assert-JsonEqual $forecastA.steps $forecastB.steps "Repeated forecasts have identical steps"
Assert-Equal $forecastA.predictedResultTree $forecastB.predictedResultTree "Repeated forecasts predict same tree"
Assert-Equal $forecastA.sourceTree $forecastA.predictedResultTree "Forecast reproduces source state"
Assert-Equal 1 $forecastA.steps.Count "Forecast has one step"
Assert-Equal "causal-rebase" $forecastA.steps[0].relation "Step relation"
Assert-True $forecastA.callerInvariants.preserved "Caller invariants are preserved"
Assert-Equal 1 $forecastA.ignoredCallerDirtyFiles "Caller draft is reported"
Assert-JsonEqual $callerBefore $callerAfterForecast "Forecast preserves caller state"

Remove-Item -LiteralPath "$cleanRepo\caller-draft.txt"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Worktree is clean before apply"
```

### 15.4 Apply the reviewed forecast

```powershell
$result = Invoke-VlabJson $cleanRepo @(
    "rebase",
    "main",
    "--use-forecast",
    $forecastA.id,
    "--json"
)

Set-Location $cleanRepo

Assert-Equal "vcs-lab.rebase/v1" $result.receipt.schema "Summary schema"
Assert-Equal $forecastA.id $result.receipt.forecastId "Reviewed forecast is named"
Assert-Equal $originalFeatureHead $result.receipt.sourceHead "Original source tip is named"
Assert-Equal $forecastA.predictedResultTree $result.receipt.resultTree "Predicted tree is reproduced"
Assert-Equal $originalFeatureTree $result.receipt.resultTree "Source state is preserved"
Assert-True $result.receipt.exactStateEqualityAfter "Exact state equality"
Assert-Equal 3 $result.receipt.absorbedChanges.Count "All logical changes are covered"
Assert-Equal 1 $result.receipt.applications.Count "Only continuation is replayed"
Assert-Equal $continuation.changeId $result.receipt.applications[0].sourceChangeId "Source ID is recorded"
Assert-Equal $continuation.changeId $result.receipt.applications[0].appliedChangeId "ID is preserved"
Assert-Equal "feature" (git branch --show-current) "Feature remains checked out"
Assert-Equal $landing.landingCommit (git rev-parse "HEAD^") "Continuation is based on landing"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Completed rebase is clean"

git merge-base --is-ancestor main feature
Assert-Equal 0 $LASTEXITCODE "Feature descends from main"

$rebaseIdle = Invoke-VlabJson $cleanRepo @(
    "rebase", "--status", "--json"
)
Assert-True (-not $rebaseIdle.active) "Successful rebase clears private operation"

$cleanValidation = Invoke-VlabJson $cleanRepo @(
    "metadata", "validate", "--json"
)
Assert-True $cleanValidation.summary.valid "Completed metadata validates"
Assert-Equal 3 $cleanValidation.summary.acceptedPortableRecords "Three portable records are accepted"

node $global:vlabCli receipts
node $global:vlabCli graph
git log --graph --oneline --decorate --all
```

### Expected result

`receipts` contains a `REBASE rebase_*` entry, `graph` contains a rebase causal
edge, and stock Git shows ordinary linear history.

## 16. TP-09 — Deterministic envelope, fresh-clone import, idempotence

### 16.1 Export twice

```powershell
$envelopeA = Join-Path $uatRoot "clean-envelope-a"
$envelopeB = Join-Path $uatRoot "clean-envelope-b"

$exportA = Invoke-VlabJson $cleanRepo @(
    "metadata", "export", $envelopeA, "--json"
)
$exportB = Invoke-VlabJson $cleanRepo @(
    "metadata", "export", $envelopeB, "--json"
)

Assert-Equal 3 $exportA.records "Envelope has three records"
Assert-True (Test-Path "$envelopeA\manifest.json") "First manifest exists"
Assert-True (Test-Path "$envelopeA\objects.bundle") "First bundle exists"
Assert-True (Test-Path "$envelopeB\manifest.json") "Second manifest exists"
Assert-True (Test-Path "$envelopeB\objects.bundle") "Second bundle exists"

$manifestHashA = (Get-FileHash "$envelopeA\manifest.json").Hash
$manifestHashB = (Get-FileHash "$envelopeB\manifest.json").Hash
$bundleHashA = (Get-FileHash "$envelopeA\objects.bundle").Hash
$bundleHashB = (Get-FileHash "$envelopeB\objects.bundle").Hash

Assert-Equal $manifestHashA $manifestHashB "Manifest export is deterministic"
Assert-Equal $bundleHashA $bundleHashB "Bundle export is deterministic"

Get-FileHash `
    "$envelopeA\manifest.json", `
    "$envelopeA\objects.bundle", `
    "$envelopeB\manifest.json", `
    "$envelopeB\objects.bundle"
```

### 16.2 Clone and verify the origin is initially absent

```powershell
$portableDestination = Join-Path $uatRoot "portable-destination"

git -c core.autocrlf=false -c core.eol=lf `
    clone --no-local $cleanRepo $portableDestination
Assert-Equal 0 $LASTEXITCODE "Fresh clone succeeds"

Set-Location $portableDestination
git config user.name "VCS Lab UAT"
git config user.email "vcs-lab-uat@example.invalid"
git config core.autocrlf false
git config core.eol lf

git cat-file -e "$($continuation.commit)^{commit}" 2>$null
$originPresentBeforeImport = $LASTEXITCODE -eq 0

Assert-True (-not $originPresentBeforeImport) "Unreachable origin is absent before import"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Destination starts clean"
```

### 16.3 Dry-run without mutation

```powershell
$refsBeforePreview = (
    git for-each-ref `
        --format="%(refname) %(objectname)" `
        refs/notes/vcs-lab refs/vcs-lab
) -join "`n"

$preview = Invoke-VlabJson $portableDestination @(
    "metadata", "import", $envelopeA, "--dry-run", "--json"
)

Set-Location $portableDestination
$refsAfterPreview = (
    git for-each-ref `
        --format="%(refname) %(objectname)" `
        refs/notes/vcs-lab refs/vcs-lab
) -join "`n"

Assert-True $preview.summary.applicable "Preview is applicable"
Assert-Equal 3 $preview.summary.addRecords "Preview proposes three records"
Assert-Equal 0 $preview.summary.conflicts "Preview has no conflicts"
Assert-Equal $refsBeforePreview $refsAfterPreview "Dry-run preserves refs"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Dry-run preserves worktree"
```

### 16.4 Apply and repeat

```powershell
$imported = Invoke-VlabJson $portableDestination @(
    "metadata", "import", $envelopeA, "--apply", "--json"
)

Assert-True $imported.applied "First import is applied"
Assert-True $imported.changed "First import changes metadata"

Set-Location $portableDestination
git cat-file -e "$($continuation.commit)^{commit}"
Assert-Equal 0 $LASTEXITCODE "Import transports unreachable origin"

$repeatedImport = Invoke-VlabJson $portableDestination @(
    "metadata", "import", $envelopeA, "--apply", "--json"
)

Assert-True $repeatedImport.applied "Repeated import remains applicable"
Assert-True (-not $repeatedImport.changed) "Repeated import is idempotent"
Assert-Equal 0 $repeatedImport.summary.addRecords "Repeated import adds no records"
Assert-Equal 0 $repeatedImport.summary.conflicts "Repeated import has no conflicts"

$destinationValidation = Invoke-VlabJson $portableDestination @(
    "metadata", "validate", "--json"
)

Assert-True $destinationValidation.summary.valid "Imported metadata validates"
Assert-Equal 3 $destinationValidation.summary.acceptedPortableRecords "All records are accepted"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Import leaves worktree clean"
```

## 17. TP-10 — Tampered-envelope rejection

### Commands

```powershell
$tamperedEnvelope = Join-Path $uatRoot "tampered-envelope"
Copy-Item -LiteralPath $envelopeA -Destination $tamperedEnvelope -Recurse
Add-Content -LiteralPath "$tamperedEnvelope\objects.bundle" -Value "intentional tamper"

Set-Location $portableDestination
$refsBeforeTamper = (
    git for-each-ref `
        --format="%(refname) %(objectname)" `
        refs/notes/vcs-lab refs/vcs-lab
) -join "`n"

$tamperAttempt = Invoke-VlabExpectedFailure $portableDestination @(
    "metadata", "import", $tamperedEnvelope, "--dry-run", "--json"
)

$refsAfterTamper = (
    git for-each-ref `
        --format="%(refname) %(objectname)" `
        refs/notes/vcs-lab refs/vcs-lab
) -join "`n"

Assert-True ($tamperAttempt.ExitCode -ne 0) "Tampered payload fails"
Assert-True ($tamperAttempt.Output -match "payload integrity check failed") "Integrity error is explicit"
Assert-Equal $refsBeforeTamper $refsAfterTamper "Tamper rejection preserves refs"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Tamper rejection preserves worktree"
```

## 18. TP-11 — Stale forecast rejection

### Commands

```powershell
$staleRepo = Join-Path $uatRoot "stale-forecast"
$staleBase = New-VlabTestRepo -Path $staleRepo

Set-Location $staleRepo
git switch -c feature $staleBase.commit

Write-Utf8Lf "$staleRepo\feature.txt" "feature`n"
git add -- feature.txt
$staleSource = Invoke-VlabJson $staleRepo @(
    "commit", "-m", "feature change", "--json"
)

$staleForecast = Invoke-VlabJson $staleRepo @(
    "rebase-forecast", "main", "--json"
)

git switch main
Write-Utf8Lf "$staleRepo\target.txt" "target moved`n"
git add -- target.txt
$null = Invoke-VlabJson $staleRepo @(
    "commit", "-m", "move target", "--json"
)

git switch feature
$headBeforeStaleAttempt = git rev-parse HEAD

$staleAttempt = Invoke-VlabExpectedFailure $staleRepo @(
    "rebase", "main", "--use-forecast", $staleForecast.id
)

Assert-True ($staleAttempt.ExitCode -ne 0) "Stale forecast fails"
Assert-True ($staleAttempt.Output -match "forecast .* is stale") "Stale error is explicit"
Assert-Equal $headBeforeStaleAttempt (git rev-parse HEAD) "Stale rejection preserves branch"
Assert-Equal $staleSource.commit (git rev-parse HEAD) "Original source remains"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Stale rejection is clean"

$staleStatus = Invoke-VlabJson $staleRepo @(
    "rebase", "--status", "--json"
)
Assert-True (-not $staleStatus.active) "Stale rejection creates no journal"
```

## 19. TP-12 — Conflict isolation and explicit fork

### 19.1 Create conflict and observer

```powershell
$forkRepo = Join-Path $uatRoot "conflict-fork"
$forkBase = New-VlabTestRepo `
    -Path $forkRepo `
    -BaseFile "shared.txt" `
    -BaseText "base`n"

Set-Location $forkRepo
git switch -c feature $forkBase.commit

Write-Utf8Lf "$forkRepo\shared.txt" "source`n"
git add -- shared.txt
$forkSource = Invoke-VlabJson $forkRepo @(
    "commit", "-m", "source change", "--json"
)

git switch main
Write-Utf8Lf "$forkRepo\shared.txt" "target`n"
git add -- shared.txt
$null = Invoke-VlabJson $forkRepo @(
    "commit", "-m", "target change", "--json"
)

git switch feature
$observer = Join-Path $uatRoot "conflict-observer"
git worktree add $observer main
Assert-Equal 0 $LASTEXITCODE "Observer worktree is created"

$pauseAttempt = Invoke-VlabExpectedFailure $forkRepo @(
    "rebase", "main"
)

Assert-True ($pauseAttempt.ExitCode -ne 0) "Conflicting rebase pauses"
Assert-True ($pauseAttempt.Output -match "causal rebase paused") "Pause is explicit"
```

### 19.2 Inspect isolation

```powershell
$paused = Invoke-VlabJson $forkRepo @(
    "rebase", "--status", "--json"
)
$observerStatus = Invoke-VlabJson $observer @(
    "rebase", "--status", "--json"
)
$privateMetadata = Invoke-VlabJson $forkRepo @(
    "metadata", "status", "--json"
)
$resolutionStatus = Invoke-VlabJson $forkRepo @(
    "resolve", "status", "--json"
)

$ownerEntry = @(
    $privateMetadata.scopes.worktreePrivate.worktrees |
        Where-Object {
            [System.IO.Path]::GetFullPath($_.path) -eq
                [System.IO.Path]::GetFullPath($forkRepo)
        }
)[0]

Assert-True $paused.active "Owner reports active rebase"
Assert-Equal "conflicted" $paused.state "State is conflicted"
Assert-Equal 0 $paused.progress.completed "No application completed"
Assert-Equal "shared.txt" $paused.current.unresolvedPaths[0] "Conflict path"
Assert-True (-not $observerStatus.active) "Observer has no private rebase"
Assert-Equal 1 $privateMetadata.scopes.worktreePrivate.pendingOperationCount "One operation is pending"
Assert-Equal "rebase" $ownerEntry.pendingOperationKinds[0] "Operation kind is rebase"
Assert-Equal 1 $resolutionStatus.conflicts.Count "Resolution tooling sees conflict"
```

### 19.3 Continue as explicit fork

```powershell
Set-Location $forkRepo
Write-Utf8Lf "$forkRepo\shared.txt" "forked resolution`n"
git add -- shared.txt

$forkedResult = Invoke-VlabJson $forkRepo @(
    "rebase", "--continue", "--fork", "--json"
)

$forkApplication = $forkedResult.receipt.applications[0]
$forkMessage = (git show -s --format=%B HEAD) -join "`n"

Assert-Equal "contextual-fork" $forkApplication.relation "Relation is contextual fork"
Assert-Equal $forkSource.changeId $forkApplication.sourceChangeId "Original ID is recorded"
Assert-True ($forkApplication.appliedChangeId -ne $forkSource.changeId) "New ID is created"
Assert-Equal $forkSource.commit $forkedResult.receipt.forkedSourceCommits[0] "Forked source is recorded"
Assert-Equal 0 $forkedResult.receipt.absorbedCommits.Count "Forked origin is not absorbed"
Assert-True ($forkMessage -match "Derived-From:") "Derived-From trailer exists"
Assert-True ($forkMessage -match "Origin-Commit:") "Origin-Commit trailer exists"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Fork completion is clean"

$forkValidation = Invoke-VlabJson $forkRepo @(
    "metadata", "validate", "--json"
)
Assert-True $forkValidation.summary.valid "Fork metadata validates"
```

## 20. TP-13 — Exact abort after partial replay

### Commands

```powershell
$abortRepo = Join-Path $uatRoot "partial-abort"
$abortBase = New-VlabTestRepo `
    -Path $abortRepo `
    -BaseFile "shared.txt" `
    -BaseText "base`n"

Set-Location $abortRepo
git switch -c feature $abortBase.commit

Write-Utf8Lf "$abortRepo\clean.txt" "clean replay`n"
git add -- clean.txt
$null = Invoke-VlabJson $abortRepo @(
    "commit", "-m", "clean first change", "--json"
)

Write-Utf8Lf "$abortRepo\shared.txt" "source`n"
git add -- shared.txt
$abortOriginal = Invoke-VlabJson $abortRepo @(
    "commit", "-m", "conflicting second change", "--json"
)

$abortOriginalTree = git rev-parse "HEAD^{tree}"

git switch main
Write-Utf8Lf "$abortRepo\shared.txt" "target`n"
git add -- shared.txt
$null = Invoke-VlabJson $abortRepo @(
    "commit", "-m", "target change", "--json"
)
git switch feature

$notesBeforeAbort = (
    git for-each-ref --format="%(refname) %(objectname)" refs/notes/vcs-lab
) -join "`n"

$partialAttempt = Invoke-VlabExpectedFailure $abortRepo @(
    "rebase", "main"
)
Assert-True ($partialAttempt.ExitCode -ne 0) "Second replay pauses"

$partialStatus = Invoke-VlabJson $abortRepo @(
    "rebase", "--status", "--json"
)

Assert-Equal "conflicted" $partialStatus.state "Partial replay is conflicted"
Assert-Equal 1 $partialStatus.progress.completed "First replay completed privately"
Assert-Equal 1 $partialStatus.applied.Count "One private provisional mapping"

$notesDuringAbort = (
    git for-each-ref --format="%(refname) %(objectname)" refs/notes/vcs-lab
) -join "`n"
Assert-Equal $notesBeforeAbort $notesDuringAbort "No shared receipt is published"

$aborted = Invoke-VlabJson $abortRepo @(
    "rebase", "--abort", "--json"
)

Assert-Equal $abortOriginal.commit $aborted.restoredHead "Abort reports original tip"
Assert-Equal $abortOriginal.commit (git rev-parse HEAD) "Abort restores commit"
Assert-Equal $abortOriginalTree (git rev-parse "HEAD^{tree}") "Abort restores tree"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Abort is clean"

$abortIdle = Invoke-VlabJson $abortRepo @(
    "rebase", "--status", "--json"
)
Assert-True (-not $abortIdle.active) "Abort clears journal"

$notesAfterAbort = (
    git for-each-ref --format="%(refname) %(objectname)" refs/notes/vcs-lab
) -join "`n"
Assert-Equal $notesBeforeAbort $notesAfterAbort "Abort publishes no receipt"
```

## 21. TP-14 — Unexpectedly empty replay

### Commands

```powershell
$emptyRepo = Join-Path $uatRoot "empty-replay"
$emptyBase = New-VlabTestRepo -Path $emptyRepo

Set-Location $emptyRepo
git switch -c feature $emptyBase.commit

$emptyCommit = Invoke-VlabJson $emptyRepo @(
    "commit",
    "-m",
    "intentional empty change",
    "--allow-empty",
    "--json"
)

$emptyPlan = Invoke-VlabJson $emptyRepo @(
    "rebase-plan", "main", "--json"
)

Assert-Equal 1 $emptyPlan.replayQueue.Count "Empty commit remains queued"
Assert-Equal $emptyCommit.commit $emptyPlan.replayQueue[0].commit "Queue identifies empty commit"

$emptyAttempt = Invoke-VlabExpectedFailure $emptyRepo @(
    "rebase", "main"
)

Assert-True ($emptyAttempt.ExitCode -ne 0) "Empty application fails"
Assert-True ($emptyAttempt.Output -match "unexpectedly empty|blocked") "Empty failure is explicit"

$emptyStatus = Invoke-VlabJson $emptyRepo @(
    "rebase", "--status", "--json"
)

Assert-True $emptyStatus.active "Blocked operation is recoverable"
Assert-Equal "blocked" $emptyStatus.state "State is blocked"
Assert-Equal 0 $emptyStatus.progress.completed "Empty application is not counted"

$emptyNotes = (
    git for-each-ref --format="%(refname)" refs/notes/vcs-lab
) -join "`n"
Assert-Equal "" $emptyNotes "Blocked application publishes no note"

$emptyAbort = Invoke-VlabJson $emptyRepo @(
    "rebase", "--abort", "--json"
)

Assert-Equal $emptyCommit.commit $emptyAbort.restoredHead "Abort restores empty commit"
Assert-Equal $emptyCommit.commit (git rev-parse HEAD) "Empty commit is restored"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Abort is clean"
```

## 22. TP-15 — Exact resolution reuse

### Objective

Teach one exact three-way resolution through reconciliation, then prove that a
matching causal-rebase forecast pins and batch-applies it.

### 22.1 Publish the exact resolution

```powershell
$resolutionRepo = Join-Path $uatRoot "resolution-reuse"
$resolutionBase = New-VlabTestRepo `
    -Path $resolutionRepo `
    -BaseFile "shared.txt" `
    -BaseText "base`n"

Set-Location $resolutionRepo
git switch -c source-one $resolutionBase.commit

Write-Utf8Lf "$resolutionRepo\shared.txt" "source`n"
git add -- shared.txt
$null = Invoke-VlabJson $resolutionRepo @(
    "commit", "-m", "source one", "--json"
)

git switch -c target-one $resolutionBase.commit
Write-Utf8Lf "$resolutionRepo\shared.txt" "target`n"
git add -- shared.txt
$null = Invoke-VlabJson $resolutionRepo @(
    "commit", "-m", "target one", "--json"
)

$rememberAttempt = Invoke-VlabExpectedFailure $resolutionRepo @(
    "reconcile", "source-one"
)
Assert-True ($rememberAttempt.ExitCode -ne 0) "Initial reconciliation pauses"

Write-Utf8Lf "$resolutionRepo\shared.txt" "remembered`n"
git add -- shared.txt

$null = Invoke-VlabJson $resolutionRepo @(
    "reconcile", "--continue", "--json"
)

$resolutionCatalog = @(
    Invoke-VlabJson $resolutionRepo @(
        "resolve", "list", "--json"
    )
)

Assert-Equal 1 $resolutionCatalog.Count "One exact resolution is retained"
```

### 22.2 Reproduce and batch-apply the conflict

```powershell
Set-Location $resolutionRepo

git switch -c source-two $resolutionBase.commit
Write-Utf8Lf "$resolutionRepo\shared.txt" "source`n"
git add -- shared.txt
$resolutionSource = Invoke-VlabJson $resolutionRepo @(
    "commit", "-m", "source two", "--json"
)

git switch -c target-two $resolutionBase.commit
Write-Utf8Lf "$resolutionRepo\shared.txt" "target`n"
git add -- shared.txt
$null = Invoke-VlabJson $resolutionRepo @(
    "commit", "-m", "target two", "--json"
)

git switch source-two

$resolutionForecast = Invoke-VlabJson $resolutionRepo @(
    "rebase-forecast", "target-two", "--json"
)

Assert-Equal "complete" $resolutionForecast.status "Resolution makes forecast complete"
Assert-Equal "exact-resolution" $resolutionForecast.steps[0].outcome "Exact-resolution outcome"
Assert-Equal 1 $resolutionForecast.approvedResolutions.Count "One resolution is pinned"

$resolutionResult = Invoke-VlabJson $resolutionRepo @(
    "rebase",
    "target-two",
    "--use-forecast",
    $resolutionForecast.id,
    "--json"
)

Set-Location $resolutionRepo

Assert-Equal $resolutionForecast.id $resolutionResult.receipt.forecastId "Pinned forecast is used"
Assert-Equal $resolutionForecast.predictedResultTree $resolutionResult.receipt.resultTree "Predicted tree is reproduced"
Assert-Equal "contextual-rebase" $resolutionResult.receipt.applications[0].relation "Same-intent contextual relation"
Assert-Equal $resolutionSource.changeId $resolutionResult.receipt.applications[0].appliedChangeId "Stable identity is preserved"
Assert-Equal "remembered`n" (Get-Content "$resolutionRepo\shared.txt" -Raw) "Remembered content is applied"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Resolution application is clean"

$resolutionValidation = Invoke-VlabJson $resolutionRepo @(
    "metadata", "validate", "--json"
)
Assert-True $resolutionValidation.summary.valid "Resolution/rebase metadata validates"
```

## 23. TP-16 — Heuristic candidate policy

### Objective

Prove that independently authored patch-equivalent work remains advisory,
cannot produce a complete forecast without approval, cannot mutate through an
incomplete forecast, and can be explicitly accepted and recorded.

### Commands

```powershell
$candidateRepo = Join-Path $uatRoot "candidate-review"
$candidateBase = New-VlabTestRepo -Path $candidateRepo

Set-Location $candidateRepo
git switch -c feature $candidateBase.commit

Write-Utf8Lf "$candidateRepo\equivalent.txt" "same patch`n"
git add -- equivalent.txt
$candidateSource = Invoke-VlabJson $candidateRepo @(
    "commit", "-m", "source patch", "--json"
)

git switch main
Write-Utf8Lf "$candidateRepo\equivalent.txt" "same patch`n"
git add -- equivalent.txt
$null = Invoke-VlabJson $candidateRepo @(
    "commit", "-m", "independent target patch", "--json"
)

$candidatePlan = Invoke-VlabJson $candidateRepo @(
    "rebase-plan", "main", "feature", "--json"
)

Assert-Equal 1 $candidatePlan.counts.'candidate-equivalent' "One candidate is reported"
Assert-Equal "review" $candidatePlan.changes[0].action "Candidate requires review"
Assert-Equal "git-patch-id-heuristic" $candidatePlan.candidates[0].proof "Proof is heuristic"
Assert-True $candidatePlan.candidateDecisionRequired "Decision is required"
Assert-True (-not $candidatePlan.executableWithoutReview) "Plan is not yet executable"

git switch feature

$reviewForecast = Invoke-VlabJson $candidateRepo @(
    "rebase-forecast", "main", "--json"
)

Assert-Equal "review-required" $reviewForecast.status "Unaccepted candidate blocks forecast"
Assert-True ($null -eq $reviewForecast.predictedResultTree) "No final tree is claimed"

$candidateHeadBefore = git rev-parse HEAD
$unacceptedAttempt = Invoke-VlabExpectedFailure $candidateRepo @(
    "rebase", "main", "--use-forecast", $reviewForecast.id
)

Assert-True ($unacceptedAttempt.ExitCode -ne 0) "Unaccepted candidate cannot apply"
Assert-Equal $candidateHeadBefore (git rev-parse HEAD) "Unaccepted rejection preserves branch"

$acceptedForecast = Invoke-VlabJson $candidateRepo @(
    "rebase-forecast", "main", "--accept-candidates", "--json"
)

Assert-Equal "complete" $acceptedForecast.status "Explicit acceptance completes forecast"
Assert-Equal 1 $acceptedForecast.acceptedCandidates.Count "Acceptance is pinned"

$candidateResult = Invoke-VlabJson $candidateRepo @(
    "rebase",
    "main",
    "--use-forecast",
    $acceptedForecast.id,
    "--json"
)

Set-Location $candidateRepo

Assert-Equal 1 $candidateResult.receipt.acceptedCandidates.Count "Summary records candidate omission"
Assert-Equal 0 $candidateResult.receipt.applications.Count "Equivalent candidate is not replayed"
Assert-Equal $acceptedForecast.predictedResultTree $candidateResult.receipt.resultTree "Accepted result matches forecast"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Accepted candidate leaves clean worktree"
```

## 24. TP-17 — Linear-v1 merge-topology rejection

### Objective

Prove that source ranges containing merge commits are unsupported and rejected
before mutation.

### Commands

```powershell
$mergeRepo = Join-Path $uatRoot "merge-topology"
$mergeBase = New-VlabTestRepo -Path $mergeRepo

Set-Location $mergeRepo
git switch -c feature $mergeBase.commit

Write-Utf8Lf "$mergeRepo\feature.txt" "feature`n"
git add -- feature.txt
$null = Invoke-VlabJson $mergeRepo @(
    "commit", "-m", "feature work", "--json"
)

git switch -c side $mergeBase.commit
Write-Utf8Lf "$mergeRepo\side.txt" "side`n"
git add -- side.txt
$null = Invoke-VlabJson $mergeRepo @(
    "commit", "-m", "side work", "--json"
)

git switch feature
git merge --no-ff side -m "merge side"
Assert-Equal 0 $LASTEXITCODE "Test merge commit is created"

$mergeHeadBefore = git rev-parse HEAD

$mergePlan = Invoke-VlabJson $mergeRepo @(
    "rebase-plan", "main", "--json"
)
$mergeForecast = Invoke-VlabJson $mergeRepo @(
    "rebase-forecast", "main", "--json"
)

Assert-True (-not $mergePlan.constraints.supported) "Linear-v1 rejects topology"
Assert-True (-not $mergePlan.constraints.linearHistory) "History is non-linear"
Assert-Equal 1 $mergePlan.constraints.mergeCommits.Count "Merge commit is identified"
Assert-Equal "unsupported" $mergeForecast.status "Forecast is unsupported"
Assert-Equal "merge-topology-unsupported" $mergeForecast.blockedReason "Topology reason is explicit"
Assert-True ($null -eq $mergeForecast.predictedResultTree) "No final tree is claimed"

$unsupportedAttempt = Invoke-VlabExpectedFailure $mergeRepo @(
    "rebase", "main"
)

Assert-True ($unsupportedAttempt.ExitCode -ne 0) "Unsupported topology cannot apply"
Assert-Equal $mergeHeadBefore (git rev-parse HEAD) "Rejection preserves branch"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Rejection leaves clean worktree"

$unsupportedStatus = Invoke-VlabJson $mergeRepo @(
    "rebase", "--status", "--json"
)
Assert-True (-not $unsupportedStatus.active) "Rejection creates no journal"
```

## 25. TP-18 — Final process, source, and evidence audit

### 25.1 Process cleanup

```powershell
Start-Sleep -Seconds 3

$newProcesses = @(
    Get-Process node, git -ErrorAction SilentlyContinue |
        Where-Object { $baselineProcessIds -notcontains $_.Id } |
        Select-Object Id, ProcessName, StartTime, Path
)

$newProcesses | Format-Table -AutoSize

if ($newProcesses.Count -gt 0) {
    Write-Host "Waiting five more seconds before final process decision." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    $newProcesses = @(
        Get-Process node, git -ErrorAction SilentlyContinue |
            Where-Object { $baselineProcessIds -notcontains $_.Id } |
            Select-Object Id, ProcessName, StartTime, Path
    )
    $newProcesses | Format-Table -AutoSize
}

Assert-Equal 0 $newProcesses.Count "No new Node or Git process remains"
```

If an unrelated application started Node/Git during the run, document it
before deciding whether the assertion represents a VCS Lab leak.

### 25.2 Source checkout audit

```powershell
Set-Location $sourceRepo

Assert-Equal $sourceHeadAtStart (git rev-parse HEAD) "Source remains at tested commit"
Assert-Equal $expectedBranch (git branch --show-current) "Source remains on tested branch"
Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Source remains clean"

git status --short --branch
git log -3 --oneline --decorate
```

### 25.3 Inventory and close transcript

```powershell
$testArtifacts = Get-ChildItem -LiteralPath $uatRoot -Force
$testArtifacts |
    Select-Object Name, FullName, LastWriteTime |
    Format-Table -AutoSize

Write-Host "UAT root:   $uatRoot"
Write-Host "Transcript: $transcript"

Stop-Transcript
```

## 26. TP-19 — Conditional release-artifact verification

Run only after a release candidate, bundle, and ZIP have been created. Replace
every placeholder with reviewed data.

### 26.1 Set and validate inputs

```powershell
$releaseVersion = "REPLACE_WITH_VERSION"
$releaseCommit = "REPLACE_WITH_FULL_COMMIT_OID"
$releaseDir = "C:\Users\jerry\OneDrive\Documents\VSCodeProjects\vcs-lab"
$bundlePath = Join-Path $releaseDir "causal-vcs-lab-$releaseVersion.bundle"
$zipPath = Join-Path $releaseDir "causal-vcs-lab-$releaseVersion.zip"
$expectedBundleSha256 = "REPLACE_WITH_64_HEX_SHA256"
$expectedZipSha256 = "REPLACE_WITH_64_HEX_SHA256"

Assert-True ($releaseVersion -ne "REPLACE_WITH_VERSION") "Release version is populated"
Assert-True ($releaseCommit -match "^[0-9a-f]{40,64}$") "Release commit is a full OID"
Assert-True ($expectedBundleSha256 -match "^[0-9a-fA-F]{64}$") "Bundle hash is populated"
Assert-True ($expectedZipSha256 -match "^[0-9a-fA-F]{64}$") "ZIP hash is populated"
Assert-True (Test-Path -LiteralPath $bundlePath) "Bundle exists"
Assert-True (Test-Path -LiteralPath $zipPath) "ZIP exists"
```

### 26.2 Hash and bundle verification

```powershell
$actualBundleHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath).Hash
$actualZipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash

Assert-Equal $expectedBundleSha256.ToUpperInvariant() $actualBundleHash "Bundle hash matches"
Assert-Equal $expectedZipSha256.ToUpperInvariant() $actualZipHash "ZIP hash matches"

git bundle verify $bundlePath
Assert-Equal 0 $LASTEXITCODE "Git bundle verifies"

Get-FileHash -Algorithm SHA256 -LiteralPath $bundlePath, $zipPath
```

### 26.3 Fresh bundle clone

```powershell
$releaseSmokeRoot = Join-Path $env:TEMP "vcs-lab-release-smoke-$releaseVersion-$stamp"
$bundleClone = Join-Path $releaseSmokeRoot "bundle-clone"

New-Item -ItemType Directory -Path $releaseSmokeRoot | Out-Null
git -c core.autocrlf=false -c core.eol=lf clone $bundlePath $bundleClone
Assert-Equal 0 $LASTEXITCODE "Bundle clone succeeds"

Set-Location $bundleClone
Assert-Equal $releaseCommit (git rev-parse HEAD) "Bundle clone is at release commit"

$env:VLAB_GIT_SESSION = "0"
npm test
Assert-Equal 0 $LASTEXITCODE "Bundle clone ordinary suite"

$env:VLAB_GIT_SESSION = "1"
npm test
Assert-Equal 0 $LASTEXITCODE "Bundle clone forced-session suite"
Remove-Item Env:VLAB_GIT_SESSION

Assert-Equal "" ((git status --porcelain=v1) -join "`n") "Bundle clone remains clean"
```

### 26.4 Fresh ZIP extraction

```powershell
$zipExtract = Join-Path $releaseSmokeRoot "zip-extract"
New-Item -ItemType Directory -Path $zipExtract | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $zipExtract

$packageCandidates = @(Get-ChildItem -LiteralPath $zipExtract -Directory)

if (Test-Path -LiteralPath (Join-Path $zipExtract "package.json")) {
    $zipProject = $zipExtract
}
elseif (
    $packageCandidates.Count -eq 1 -and
    (Test-Path -LiteralPath (Join-Path $packageCandidates[0].FullName "package.json"))
) {
    $zipProject = $packageCandidates[0].FullName
}
else {
    throw "Could not identify ZIP project root."
}

Set-Location $zipProject

$env:VLAB_GIT_SESSION = "0"
npm test
Assert-Equal 0 $LASTEXITCODE "ZIP ordinary suite"

$env:VLAB_GIT_SESSION = "1"
npm test
Assert-Equal 0 $LASTEXITCODE "ZIP forced-session suite"
Remove-Item Env:VLAB_GIT_SESSION
```

### 26.5 Version/tag agreement

```powershell
Set-Location $bundleClone

$releasePackage = Get-Content package.json -Raw | ConvertFrom-Json
$releaseCliVersion = (& node .\bin\vlab.js version) -join "`n"
$tagAtHead = @(git tag --points-at HEAD)

Assert-Equal $releaseVersion $releasePackage.version "Package version agreement"
Assert-True ($releaseCliVersion -match [regex]::Escape($releaseVersion)) "CLI version agreement"
Assert-True ($tagAtHead -contains "v$releaseVersion") "Release tag agreement"
```

## 27. TP-20 — Safe cleanup

Do not clean up after a failure. Retain all evidence for diagnosis.

### 27.1 Restore variables after a shell restart, if necessary

```powershell
$uatRoot = "REPLACE_WITH_EXACT_RETAINED_UAT_PATH"
$transcript = "REPLACE_WITH_EXACT_RETAINED_TRANSCRIPT_PATH"
```

Skip this block if the original variables are still present.

### 27.2 Validate and remove the UAT root

```powershell
$resolvedUatRoot = [System.IO.Path]::GetFullPath($uatRoot)
$resolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP)

Assert-True (
    $resolvedUatRoot.StartsWith(
        $resolvedTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    )
) "Cleanup target is inside system temp"

Assert-True (
    (Split-Path $resolvedUatRoot -Leaf) -like "vcs-lab-uat-*"
) "Cleanup target has expected UAT name"

Write-Host "Validated cleanup target: $resolvedUatRoot"

Remove-Item -LiteralPath $resolvedUatRoot -Recurse -Force

if (Test-Path -LiteralPath $transcript) {
    Remove-Item -LiteralPath $transcript -Force
}

Assert-True (-not (Test-Path -LiteralPath $resolvedUatRoot)) "UAT root removed"
Assert-True (-not (Test-Path -LiteralPath $transcript)) "Transcript removed"
```

### 27.3 Remove conditional release-smoke root

Run only if TP-19 was executed:

```powershell
$resolvedReleaseSmokeRoot = [System.IO.Path]::GetFullPath($releaseSmokeRoot)

Assert-True (
    $resolvedReleaseSmokeRoot.StartsWith(
        $resolvedTempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    )
) "Release-smoke target is inside system temp"

Assert-True (
    (Split-Path $resolvedReleaseSmokeRoot -Leaf) -like "vcs-lab-release-smoke-*"
) "Release-smoke target has expected name"

Remove-Item -LiteralPath $resolvedReleaseSmokeRoot -Recurse -Force
Assert-True (-not (Test-Path -LiteralPath $resolvedReleaseSmokeRoot)) "Release-smoke root removed"
```

## 28. Failure capture and recovery

At the first unexpected failure, do not clean up. Run:

```powershell
$failureTime = Get-Date -Format "o"
$failureRepo = (Get-Location).Path

Write-Host "Failure time: $failureTime"
Write-Host "Failure repo: $failureRepo"

git status --short --branch
git branch --show-current
git rev-parse HEAD
git worktree list --porcelain
git for-each-ref `
    --format="%(refname) %(objectname)" `
    refs/notes/vcs-lab refs/vcs-lab

& node $global:vlabCli rebase --status --json
& node $global:vlabCli reconcile --status --json
& node $global:vlabCli resolve status --json
& node $global:vlabCli metadata status --json
& node $global:vlabCli metadata validate --json

Get-Process node, git -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, StartTime, Path |
    Format-Table -AutoSize

Write-Host "Retain UAT root:   $uatRoot"
Write-Host "Retain transcript: $transcript"
```

For an intentionally paused causal rebase, capture the preceding evidence
before selecting exactly one recovery:

```powershell
# Same-intent resolution after editing and staging:
node $global:vlabCli rebase --continue --json

# Deliberate semantic divergence after editing and staging:
node $global:vlabCli rebase --continue --fork --json

# Restore the exact original source tip:
node $global:vlabCli rebase --abort --json
```

Do not run all three commands.

## 29. Test report template

```text
VCS Lab test execution
=======================
Date/time:
Operator:
Computer:
PowerShell:
Node:
Git:
Branch:
Commit:
Transcript:
UAT root:

TP-01 Bootstrap: PASS / FAIL
TP-02 Source/version: PASS / FAIL
TP-03 Ordinary suite: PASS / FAIL (43/43 required)
TP-04 Forced-session suite: PASS / FAIL (43/43 required)
TP-05 Static gates: PASS / FAIL
TP-06 Demos: PASS / FAIL (6/6 required)
TP-07 Consumer smoke: PASS / FAIL / SKIP
TP-08 Clean reviewed rebase: PASS / FAIL
TP-09 Envelope/import/idempotence: PASS / FAIL
TP-10 Tamper rejection: PASS / FAIL
TP-11 Stale forecast: PASS / FAIL
TP-12 Conflict/fork/isolation: PASS / FAIL
TP-13 Partial abort: PASS / FAIL
TP-14 Unexpected empty: PASS / FAIL
TP-15 Resolution reuse: PASS / FAIL
TP-16 Candidate policy: PASS / FAIL
TP-17 Merge topology: PASS / FAIL
TP-18 Final audit: PASS / FAIL
TP-19 Release artifacts: PASS / FAIL / NOT RUN
TP-20 Cleanup: PASS / FAIL / RETAINED

Git-session demo
----------------
Logical queries:
Session processes:
Ordinary processes:
Process reduction:
Semantic equality: YES / NO

Metadata portability
--------------------
Manifest SHA-256:
Bundle SHA-256:
Dry-run refs unchanged: YES / NO
First import changed: YES / NO
Repeated import no-op: YES / NO
Unreachable origin transported: YES / NO
Tamper rejected: YES / NO
Tamper refs unchanged: YES / NO

Final result: PASS / FAIL
Open defects:
Retained evidence:
```
