# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the ES-module implementation. Keep domain behavior in focused
modules such as `merge-plan.js`, `workspaces.js`, and `metadata.js`; `src/cli.js`
owns command parsing and presentation. `bin/vlab.js` is the executable entry
point. `test/integration.test.js` exercises the real CLI against disposable Git
repositories. Maintained demonstrations and repository utilities live in
`scripts/`. Product, architecture, testing, and ADR documentation lives under
`docs/`; keep only `README.md`, `CHANGELOG.md`, this guide, and the thin
`CLAUDE.md` that imports it at the root. Agent skills are canonical in
`.agents/skills/` and mirrored into `.claude/skills/` by `npm run sync:agents`
so Codex and Claude Code read the same instructions; never hand-edit the
mirror.

## Build, Test, and Development Commands

The project requires Node.js 20+ and Git 2.40+. It has no runtime dependencies
or build step.

- `npm test` runs the complete Node integration suite.
- `npm run test:docs` checks local Markdown link targets.
- `npm run sync:agents` regenerates `.claude/skills/` from `.agents/skills/`;
  `npm run sync:agents -- --check` reports drift without writing.
- `npm run demo` runs the primary workflow demonstration; the other `demo:*`
  scripts exercise conflicts, resolutions, forecasts, specs, and Git sessions.
- `node ./bin/vlab.js --help` runs the CLI directly without installing it.
- `npm link` optionally exposes `vlab` in the local shell.

## Coding Style & Naming Conventions

Use ESM imports, two-space indentation, double quotes, and semicolons, matching
the existing source. Prefer `camelCase` for functions and variables,
`PascalCase` for classes, `UPPER_SNAKE_CASE` for constants, and descriptive
kebab-case module names. Keep synchronous Git orchestration explicit and avoid
adding dependencies without a demonstrated need. There is no configured
formatter or linter; run `git diff --check` and `node --check <file>`.

## Testing Guidelines

Tests use `node:test` and descriptive behavior names such as
`test("stale forecasts fail before starting a reconciliation", ...)`. Add
regression coverage for observable changes and use temporary repositories for
history-changing cases. For Git-session or cross-cutting changes, run both
`npm test` and `VLAB_GIT_SESSION=1 npm test`. No numeric coverage threshold is
defined; preserve the behavioral and failure-safety guarantees in
`docs/testing.md`.

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects with conventional prefixes:
`feat:`, `fix:`, `docs:`, and `chore:`. Keep each commit scoped to one coherent
change. Pull requests should explain intent and compatibility impact, link the
relevant issue or ADR, list validation commands and results, and update the
README, changelog, or durable docs when contracts change. Screenshots are
normally unnecessary for this CLI; include focused terminal output when it
clarifies behavior.

## Safety & Documentation

Never run destructive experiments in a valuable repository. Preserve dirty
worktrees and use bounded temporary fixtures. Treat Git metadata as untrusted
input. Track active implementation briefs and run-specific evidence in issues,
pull requests, or CI artifacts rather than committing session handoffs or
timestamped result reports.
