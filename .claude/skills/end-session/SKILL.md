---
name: end-session
description: End a vcs-lab work session cleanly — capture what was learned into memory, bring GitHub issues and durable records (ADRs, roadmap, changelog debt, retained evidence) up to date, and clean the local checkout of disposable fixtures, stray worktrees, and runtime state. Use when the user says "end session", "wrap up", "done for the day", or asks to clean things up before stopping.
---

# End session

The charter, verbatim:

> clean up the local workspace, and update memory, GitHub issues, and any
> durable records that need it from this session.

**Announce at start:** "I'm using the end-session skill to close out this
session."

## Why this exists

A session's durable output is not just the diff. It also produces things that
live outside the tracked tree, each of which rots silently if nobody writes to
it: **memory** (what the agent now knows about this project that the docs do
not say), **GitHub issues** (this repository's only tracker for active work,
implementation briefs, handoffs, and deferred follow-ups), **durable records**
(ADRs, the roadmap, the changelog's `Unreleased` section, and evidence retained
where `docs/README.md` says it belongs), and the **local checkout** (disposable
Git fixtures in the OS temp directory, worktrees or `vlab/ws/*` branches that an
agent created by mistake, runtime state under `.git/vcs-lab/`, lingering Git
session processes, and static-check drift that fails the next session for
unrelated reasons).

This skill is a sweep over those four, in that order, at the end of a work
session. It applies equally when Claude Code or Codex ran the session; the
memory lane applies only to an agent that has a persistent memory directory.

## Ground rules

- **Nothing invented.** If a lane has nothing to record, say "nothing to
  record" for that lane and move on. A speculative memory or a filler issue
  comment is worse than silence.
- **Nothing destroyed without a yes.** Every deletion, branch removal, worktree
  removal, or discard is shown as a list first.
- **Nothing pushed.** This skill does not commit, push, tag, or open pull
  requests; the user asks for those explicitly. It also does not rewrite
  `README.md`, `AGENTS.md`, `CHANGELOG.md`, or `docs/`; those belong to the
  work commits that change a contract (see `AGENTS.md`), and this pass only
  records debt.
- **Never run destructive experiments in this checkout.** `vlab` commands
  mutate the refs, notes, and workspace registry of whatever repository is the
  working directory. Experiments belong in disposable repositories under the
  session scratchpad or `os.tmpdir()`, never in `~/dev/vcs-lab` itself.

## Steps

### 1. Scope the session

Establish what actually happened before writing anything. Read the
conversation, then confirm it against the repository:

```bash
git status --porcelain
git branch --show-current
git log --oneline --since=midnight        # anything landed today
git tag --contains HEAD~5 2>/dev/null     # releases cut recently
gh issue list --state open --limit 20
gh pr list --author @me --state all --limit 5
```

Then name, out loud, the session's four buckets: what was **learned**, what
**issue** work it touched, what **durable records or evidence** it produced or
made stale, and what **files, fixtures, refs, or processes** it left behind.
The rest of the skill works that list.

### 2. Update memory (agents with a memory directory)

Memory lives outside the repository in the agent's project memory directory
(for Claude Code, `~/.claude/projects/<project-slug>/memory/`, where the slug
encodes the checkout path), one fact per file with `name` / `description` /
`metadata.type` (`user`, `feedback`, `project`, `reference`) frontmatter and a
one-line pointer in `MEMORY.md`. Codex sessions skip this lane and say so.

- **Prefer updating an existing file to creating a new one.** This project's
  standing memories are the usual landing spots: the agent-hygiene note (why
  subagents must use disposable repositories), the release and scan-batching
  state note, and the native-substrate decisions note. Read `MEMORY.md` first.
- **Do not save what the repository already records.** `AGENTS.md`,
  `docs/product.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/adr/`,
  the changelog, and Git history are durable. Memory is for what is not written
  down: a trap that cost an hour, a preference the user stated, a host-specific
  measurement that shaped a decision, the state of uncommitted or half-decided
  work.
- Convert relative dates to absolute (`today` becomes `2026-08-28`) and link
  related memories with `[[slug]]`.
- **Delete or correct memories this session falsified.** A memory that is now
  wrong is worse than a missing one; a note that says work is uncommitted after
  it was pushed is the standing example.

### 3. Update GitHub issues

Issues are the tracker for active work, bugs, implementation briefs, and
session handoffs (`docs/README.md`). Use `gh`, which infers the repository from
the clone. The repository uses GitHub's default labels only (`bug`,
`enhancement`, `documentation`, `question`, `wontfix`, and so on); do not
invent a triage scheme.

For each issue this session touched:

- **Record decisions where the docs cite the issue.** ADRs and the roadmap cite
  issue numbers as the durable record of an implementation brief (ADR-0013
  cites issue #1). A decision reached in conversation and never commented onto
  its issue is effectively lost: `gh issue comment <n> --body "..."`.
- **Close what shipped**, naming the commit or tag that delivered it:
  `gh issue close <n> --comment "..."`. If the work merged but a follow-up
  remains, close the issue and open the follow-up rather than leaving a
  half-done issue open.
- **Open issues for deferred work discovered this session**: the divergence
  you noticed and chose not to fix, the ADR a conversation decision still
  needs, the evidence rerun another host must produce. Use a heredoc for the
  body and say which document or ADR the issue serves.
- **Attach evidence to issues rather than the tree.** Benchmark JSON, gate
  logs, and review outputs from the scratchpad belong in an issue comment, a
  pull request, or a CI artifact, never as a committed timestamped report.

### 4. Update durable records and retained evidence

This repository keeps no private companion; the equivalent lane is the set of
records that `docs/README.md` says must stay current, plus the evidence policy
in `docs/testing.md`.

- **Decisions without a record.** If the session reached a decision that
  changes a durable contract (a schema, an algorithm, a persistence scope, a
  gate, a supported baseline) and no ADR or roadmap entry records it, do not
  write the ADR here; open an issue that names the decision and the ADR it
  needs, and say so in the report.
- **Changelog debt.** Every behavior change committed this session should
  already have a bullet under `CHANGELOG.md` `Unreleased` from its own commit.
  If one is missing, note it as debt in the report; do not edit the changelog
  in this pass.
- **Evidence retention.** Performance results go into an ADR only when they
  support a decision; machine-readable baselines are committed only when an
  automated check consumes them; individual runs, logs, hashes, and
  host-specific figures stay with the issue, pull request, or CI run. Nothing
  timestamped, workstation-specific, or tied to a commit under test is
  committed, and no archive directory is added for superseded session
  documents.
- **Published pages.** If the session published or updated a shareable page
  (a strategy exploration, a review summary) and later decisions made it
  stale, update it or note the staleness; do not let a page contradict the
  ADRs.
- **Sweep the tracked tree.** Scratch files, session handoffs, result reports,
  packed tarballs, and benchmark output must not be sitting in the checkout
  waiting to be committed. Move them to the scratchpad or an issue, or delete
  them after showing the list.

### 5. Clean the local checkout

Show findings before acting. Work through:

- **Uncommitted work**: `git status --porcelain`. Ask what to do with it;
  never commit silently and never discard. If it is mid-flight work the user is
  returning to, leaving it dirty is a valid answer, but say so in the report.
- **Untracked strays**: `git status --porcelain --untracked-files=all` and
  `git clean -nd` (dry run). Show the list and get a yes before `git clean -fd`.
  Never `git clean -x`: the ignored set includes `node_modules/`, `*.log`, and
  packed `causal-vcs-lab-*.bundle` / `.zip` artifacts the user may be keeping.
- **Repository state that `vlab` or an agent left in this checkout.** The real
  checkout should normally have one worktree, no `vlab/ws/*` branches, no
  `.git/vcs-lab/` runtime directory, and no `refs/vcs-lab/*` or
  `refs/notes/vcs-lab` unless the user deliberately dogfoods `vlab` here.
  Inspect before touching anything:

  ```bash
  git worktree list
  git branch --list 'vlab/ws/*'
  ls -la .git/vcs-lab 2>/dev/null
  git for-each-ref refs/vcs-lab refs/notes/vcs-lab
  ls -d "$(dirname "$PWD")"/*.workspaces 2>/dev/null
  ```

  Anything an agent created by running `vlab` with the wrong working directory
  is listed with its timestamp and removed only after a yes
  (`git worktree remove --force <path>`, `git branch -D <branch>`,
  `git worktree prune`, deleting `.git/vcs-lab/`). Anything the user created on
  purpose stays.
- **Disposable fixtures in the OS temp directory.** Tests, forecasts, and the
  benchmarks remove their own `vcs-lab-test-*`, `vcs-lab-forecast-*`,
  `vcs-lab-scale-benchmark-*`, `vcs-lab-spec-benchmark-*`, and
  `vcs-lab-benchmark-check-*` repositories, so
  any of those left behind mark an interrupted run; the demos keep
  `vcs-lab-*demo-*` repositories by design for inspection; gate or experiment
  scripts may leave `vcs-lab-gate-*` and similar. List them and remove after a
  yes; a leftover `vcs-lab-scale-benchmark-*` directory makes the benchmark
  test's cleanup assertion fail in the next session.

  ```bash
  ls -d "$(node -e 'console.log(require("os").tmpdir())')"/vcs-lab-* 2>/dev/null
  ```

- **Lingering processes.** The release gate requires that no VCS Lab Node or
  Git process survives a run:

  ```bash
  ps -eo pid,etimes,args | grep -E 'bin/vlab\.js|git-session-worker|cat-file --batch' | grep -v grep
  ```

- **Session scratchpad.** Keep evidence an open issue still references; clear
  finished experiment repositories, review outputs, and packed tarballs.
- **Static checks.** Leaving these red fails the next session for unrelated
  reasons:

  ```bash
  git diff --check
  npm run test:docs
  npm run sync:agents -- --check      # .claude/skills mirrors .agents/skills
  for f in $(git ls-files 'src/*.js' 'bin/*.js' 'scripts/*.mjs' 'test/*.js'); do node --check "$f"; done
  ```

  Fix skill drift with `npm run sync:agents`; never hand-edit
  `.claude/skills/`, it is generated from `.agents/skills/`. If source changed
  and was not qualified, remind the user that `npm test`,
  `VLAB_GIT_SESSION=1 npm test`, `VLAB_GIT_SESSION=0 npm test`,
  `VLAB_FORECAST_ENGINE=worktree npm test`,
  `VLAB_FORECAST_ENGINE=merge-tree npm test`, and `VLAB_ENGINE=native npm test`
  are the qualification commands (about 60 seconds each on Linux, five
  minutes on Windows); run them only if asked. A pushed commit gets the same
  matrix on both platforms from `.github/workflows/ci.yml`.
- **Nothing staged that must never be committed**: `git diff --cached
  --name-only` must contain no benchmark JSON, gate or review logs, packed
  tarballs, bundles, scratch scripts, or files with machine-local paths.

### 6. Report

One short paragraph per lane — memory, issues, durable records, checkout —
naming what changed and what was deliberately left alone. End with **what is
still open**: the uncommitted work, the issue awaiting a reply, the evidence
another host still has to produce, the next roadmap increment. That paragraph
is what makes the next session cheap to start.

## Do not

- Commit, push, tag, or open pull requests; the user asks for those.
- Run `vlab` or any state-changing Git command against this checkout as an
  experiment; use disposable repositories.
- Delete uncommitted or untracked files, branches, worktrees, or temp
  fixtures without showing the list first.
- Rewrite `README.md`, `AGENTS.md`, `CHANGELOG.md`, or `docs/` here; record
  debt as an issue instead.
- Invent memories, issue comments, or evidence to make a lane look productive.
