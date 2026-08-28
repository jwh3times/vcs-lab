# Testing and qualification

This document defines the maintained validation contract. Tests create
disposable repositories and exercise the real CLI and Git executable; do not
run history-changing manual experiments in a valuable repository.

## Requirements

- Node.js 20 or newer
- Git 2.40 or newer
- a clean source checkout for release qualification
- enough system temporary space for disposable repositories

The package has no runtime dependencies and no build step.

## Development validation

Run the complete integration suite in ordinary mode:

```bash
npm test
```

Run it again with the invocation-scoped Git object session forced:

```powershell
$env:VLAB_GIT_SESSION = "1"
npm test
Remove-Item Env:VLAB_GIT_SESSION -ErrorAction SilentlyContinue
```

On POSIX shells:

```bash
VLAB_GIT_SESSION=1 npm test
```

Run the maintained demonstrations when changing their workflows:

```bash
npm run demo
npm run demo:conflict
npm run demo:resolution
npm run demo:forecast
npm run demo:spec
npm run demo:git-session
```

Use targeted Node test-name patterns during development, but complete both
ordinary and forced-session runs before treating a cross-cutting change as
qualified.

## Static checks

Before merging a documentation or source change:

```bash
git diff --check
npm run test:docs
node --check src/cli.js
node --test
```

For broad JavaScript changes, run `node --check` over every tracked JavaScript
file under `src`, `bin`, `scripts`, and `test`. `npm run test:docs` verifies
local Markdown link targets. New or changed formal requirement IDs must remain
unique and every reference must resolve to a definition.

## Release gate

A release candidate is eligible only when:

1. the source checkout begins and ends clean at the same candidate commit;
2. the integration suite passes in ordinary and forced-session modes;
3. all maintained demos complete;
4. metadata validation reports no unexpected errors;
5. expected-failure cases leave protected refs and worktrees unchanged;
6. no VCS Lab Node or Git process remains after completion;
7. version constants, package metadata, changelog, and release tag agree; and
8. the packed artifact passes an install and smoke test outside the source
   checkout; and
9. when a committed benchmark baseline exists, the automated regression check
   that consumes it passes.

New schemas, migration behavior, replay algorithms, or performance decisions
require focused disposable-repository coverage in addition to this general
gate. Release qualification does not establish production readiness, security
review, service-level objectives, or broad platform performance.

## Evidence retention

Record the tested commit, platform and tool versions, command outcome, and any
material exception in the pull request or release summary. Store raw logs and
generated repositories as CI artifacts with an explicit retention period; do
not commit timestamped result reports or machine-local temporary paths.

If a failure produces a lasting design constraint, add or supersede an ADR. If
it produces a product correction, add a regression test and changelog entry.
Git history remains the record of prior one-off qualification documents.
