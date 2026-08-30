# Changelog

## Unreleased

- Make `merge-tree` the default forecast engine on Windows and keep
  `worktree` the default on other platforms, mirroring the object session's
  platform default; `VLAB_FORECAST_ENGINE` and `--forecast-engine` override
  either, and the suite is now qualified with each engine forced on every
  host. The decision follows the POSIX evidence below: on Linux the engine
  saves about a third of a quarter-second forecast while distribution Git is
  often below 2.49, on Windows it saves 2.5× over the session path and Git
  for Windows is current (ADR-0016 amendment, issue #7).
- Commit the `linux` entry of `benchmarks/baseline.json` (Ubuntu 24.04,
  Git 2.55.0, Node 22.23.2: 63, 24, and 9 forecast processes in the
  worktree-ordinary, worktree-session, and merge-tree-session modes, as on
  `win32`), so `npm run test:benchmark` is active on Linux hosts, and record
  the POSIX evidence for ADR-0016 in its 2026-08-30 amendment: byte-identical
  trees in every suite mode on Ubuntu 24.04 (Git 2.55.0), Alpine 3.22
  (Git 2.49.1, the floor), and Debian 13 (Git 2.47.3, exercising the
  fallback), and 64, 25, and 10 Git processes for the 12-change demo forecast
  in ordinary, session, and merge-tree modes on Linux, as on Windows
  (issue #7).
- Raise the merge-tree forecast engine's Git floor from 2.45 to 2.49 and
  detect an older Git before the first merge instead of after the session
  timeout. The first POSIX run (Debian 13, Git 2.47.3) showed that
  `git merge-tree --stdin` flushes each record only from Git 2.49 (commit
  `344a107b`, "merge-tree --stdin: flush stdout to avoid deadlock"); on
  2.45–2.48 every merge-tree forecast waited out the 60 s session timeout
  before falling back. The session process now runs with `GIT_TRACE2_EVENT=2`
  and the worker reads its trace2 `version` event from stderr before writing
  any request, so an older Git yields an immediate `git-too-old` fallback
  that names the version, with no extra process on any path; Git's own
  stderr messages stay separate from the trace2 lines. The differential
  tests, the demo, and the benchmark's merge-tree mode skip below 2.49, and a
  new scenario verifies the immediate fallback with a spoofed version
  (`VLAB_TEST_MERGE_TREE_GIT_VERSION`) and, on hosts below the floor, with
  the real one (ADR-0016 amendment, issue #7).
- Disable Git `rerere` inside every vlab `cherry-pick` (forecast simulation,
  `reconcile`, `rebase`, `vlab cherry-pick`, and their `--continue` paths)
  and every landing merge with `-c rerere.enabled=false`, so a resolution
  recorded in `.git/rr-cache` can no longer be replayed into a forecast, an
  application, or a landing unapproved, nor recorded from vlab's picks. A
  conflict that Git used to auto-stage is now reported as the conflict it is,
  with its signature and candidates, under both forecast engines and both Git
  session modes (ADR-0018, issue #6).
- Make `vlab metadata validate` and `vlab resolve list` agree on retention
  state (issue #4): validation now peels each `refs/vcs-lab/resolutions/*`
  target exactly as the catalog does, so a ref that names an annotated tag of
  its retention commit is accepted (and `metadata export`/`import` carry the
  raw tag target through), and the catalog no longer reads a note stored as a
  bare JSON array of records, which validation already quarantined as a
  malformed container. Migration: `vlab` never wrote either shape; a bare-array
  note must be rewritten as `{"schema":"vcs-lab.note/v1","records":[...]}` or
  its conflict re-resolved once (`vlab resolve` republishes over such a ref).
  The peel costs complete metadata status one additional bounded Git process
  outside the object session (12 rather than 11 in the ADR-0013 fixture).
- Record the Windows post-batching rerun of
  `vcs-lab.repository-scale-benchmark/v1` in ADR-0013: workspace status fell
  from 1,598 ms to 410 ms (36 to 12 processes) and the resolution catalog from
  5,504 ms to 254 ms (103 to 6 processes) with identical results in both
  Git-session modes and no phase over budget, completing the Windows half of
  ADR-0014 Gate A item 2 and ending Horizon 1 optimization.
- Add an opt-in merge-tree forecast engine (`VLAB_FORECAST_ENGINE=merge-tree`,
  `--forecast-engine`) that simulates clean reconciliation, workspace, and
  rebase forecast steps through one persistent `git merge-tree --stdin`
  process with no temporary worktree, pins the same per-step and predicted
  trees as the worktree simulator, falls back to the worktree simulator with a
  recorded reason for any conflicted, empty, merge-commit, root-commit, or
  attribute-changing step or session failure, and reports `engine`,
  `fallbacks`, and `timings.mergeTree` in both forecast schemas without a
  version change. The engine needs Git 2.49 (see the next entry) and records
  a `git-too-old` fallback on older Git, where the
  merge-tree suite scenarios skip. Extend `demo:git-session` to compare
  ordinary, session, and merge-tree modes (64, 25, and 10 Git processes for
  the 12-change forecast on
  the Windows development host), add a third suite mode, and accept ADR-0016.
- Add `npm run test:benchmark`, an automated regression check that measures a
  reduced scale fixture and a 12-change forecast in ordinary, session, and
  merge-tree modes and compares process counts (exact) and medians (within
  twice the baseline plus a 5 ms floor) against the committed per-host
  `benchmarks/baseline.json`, skipping hosts without an entry;
  `npm run benchmark:record` refreshes an entry. Release gate item 9 is now
  active on hosts with a baseline; accept ADR-0017.
- Raise the supported Git baseline from 2.38 to 2.40 (`git merge-tree
  --merge-base`; ADR-0015). Update README, AGENTS.md, testing, and
  architecture requirements accordingly.
- Accept ADR-0014: split the native implementation gate into a
  semantics-preserving engine gate (Gate A, equality-tested seam with a
  two-release sunset) and a semantics-changing store gate (Gate B, the
  original eight conditions plus dogfooded agent-workload evidence), and
  define "more efficient than Git" as elapsed time and bytes stored and
  transferred against Git and any named alternative.
- Accept ADR-0015: a phased native-core program with Rust as the core
  language, entering behind existing CLI contracts only after a Git-native
  first increment, with funded toolchain, packaging, and backend costs.
- Add roadmap Horizon 1.5, the phased Horizon 5, NFR-PERF-06/07, a
  benchmark-regression release-gate item, and dogfooding metrics in PRD §13.
- Add the `end-session` agent skill (memory, GitHub issues, durable records
  and evidence, local-checkout cleanup) as the canonical `.agents/skills/`
  copy with a generated `.claude/skills/` mirror, `npm run sync:agents` with a
  `--check` mode, and a thin `CLAUDE.md` that imports `AGENTS.md`.

## 0.9.0

- Consolidate maintained product, architecture, testing, and decision records
  under `docs/`; move active implementation briefs to issue tracking and stop
  committing session handoffs or timestamped test-result reports.

- Batch the two scan hot paths selected by ADR-0013: inspect each materialized
  workspace with one worktree-scoped `git status --porcelain=v2 --branch -z`
  query that answers usability, exact head, and dirty count together, and
  discover retained resolution refs with one `for-each-ref` scan, peel their
  targets with one batched object check, and read their records with one
  batched note read instead of per-ref revision resolution and
  `git notes show`.
- Keep workspace and resolution JSON semantically unchanged, including
  missing-versus-invalid paths, archived lifecycle, ref/commit/signature
  agreement, retained result-blob checks, deleted results, and newest-first
  ordering. Retention refs that are dangling or do not name a commit are now
  quarantined from the catalog instead of failing the whole listing, and a
  failed ref scan is an error rather than an empty catalog. A registered
  workspace path that is not a directory is reported as `invalid` instead of
  aborting the listing, an unborn workspace `HEAD` reports a `null` head, and
  a recognized worktree whose status cannot be read still fails loudly.
- Make the repository-scale analysis require at least ten measured entities
  before treating a processes-per-entity ratio as amplification, so tiny
  custom fixtures ask for more volume instead of misreporting a bounded batch
  cost as per-entity process launches.
- Rerun `vcs-lab.repository-scale-benchmark/v1` without changing the fixture:
  the representative profile now uses one Git process per workspace (12 rather
  than 36) and six processes for the 50-resolution catalog (rather than 103),
  and the decision output selects larger fixtures and more hosts instead of an
  index or service.

- Add bounded `vlab metadata benchmark` fixtures for history, linked worktrees,
  workspace registry/status, causal notes, retained resolutions, and complete
  metadata inventory, with semantic equality across samples and trendable
  `vcs-lab.repository-scale-benchmark/v1` JSON.
- Separate fixture setup from cold/warm scan measurements, report logical and
  actual Git-process costs, omit repository content and identities, and remove
  the disposable repository after every run.
- Accept ADR-0013's evidence gate: batch the measured workspace-status and
  resolution-catalog process amplification first, rerun the same schema, and
  add neither persistent indexes nor a resident service without post-batching
  representative evidence.

- Add conservative workspace move, archive, restore, stale-path repair, and
  preview/apply prune commands while retaining workspace, branch, and checkpoint
  identity.
- Give checkpoints stable `draft_` identity plus retained history refs, and add
  `workspace forecast --source-checkpoint` for immutable source-draft
  forecasting without reading live dirty bytes.
- Accept ADR-0012's reversible-materialization and checkpoint-input model.

- Fix the intermittent Windows forced-session hang by starting the persistent
  object worker lazily, after synchronous Git preflight commands complete,
  instead of racing worker startup with `git status`.
- Reject pending object requests on any unexpected worker-Git exit, add opt-in
  session lifecycle diagnostics, and cover the no-worker preflight path in the
  integration suite.
- Wait for the worker Git child's stdio-drained `close` event during shutdown
  and retain a bounded Windows process-tree termination fallback.

- Accept ADR-0011's bounded model of causal rebase as a forecasted sequence of
  target-context applications with linear-v1 scope and fail-closed recovery.
- Add read-only `vlab rebase-plan <onto> [<source>]` using the existing exact
  coverage lattice to classify changes as omit, review, or replay without
  switching the caller.
- Add deterministic rebase-plan fingerprints, explicit heuristic-review state,
  ordered replay queues, and unsupported merge-topology diagnostics.
- Add non-mutating `vlab rebase-forecast <onto> [<source>]` with an isolated
  replay worktree, exact target-before/result trees, predicted-tree pinning,
  caller-state digests, and worktree-private `vcs-lab.rebase-forecast/v1`
  artifacts.
- Keep patch-equivalent candidates fail-closed until `--accept-candidates`
  records an explicit omission decision; expose conflicts and unsupported
  merge topology without changing the caller.
- Add supervised `vlab rebase <onto>` application for the current named branch,
  with saved-forecast staleness checks, exact per-step tree enforcement, stable
  Change IDs, explicit contextual forks, and blocked unexpected empty commits.
- Add worktree-private `vcs-lab.rebase-operation/v1` journals plus process-safe
  status/continue/abort recovery; exact abort restores the original source tip
  and no application or summary facts publish before complete success.
- Add validated shared `vcs-lab.rebase-application/v1` and
  `vcs-lab.rebase/v1` records, causal coverage/graph/receipt integration, and
  deterministic envelopes that retain referenced history made unreachable by
  the branch rewrite.
- Add disposable-repository tests for hard-squash continuation selection,
  repeatable caller non-mutation, advisory patch equivalence, and the linear-v1
  merge boundary, plus deterministic rebase forecasts, candidate pinning, and
  conflict cleanup in ordinary and persistent Git-session modes. Add supervised
  application tests for clean forecast reproduction, stale rejection,
  exact-resolution reuse, conflict fork, unexpected empty blocking, partial
  abort, linked-worktree isolation, and fresh-clone metadata portability.
- Harden persistent Git-session shutdown by closing the batch-command input,
  waiting for the underlying Git process to exit, and retaining bounded
  terminate/fallback paths so Windows invocations do not leave worker or Git
  processes behind.

## 0.8.0

- Add deterministic `metadata status` and `metadata validate` inventory across
  shared-portable notes/resolutions, tracked spec manifests, shared-local
  workspaces/checkpoints, and worktree-private operations/forecasts.
- Validate supported causal record shapes, attachments, referenced Git
  objects, resolution signatures, retention refs/result blobs, record-ID
  conflicts, spec/source consistency, and local workspace health with stable
  diagnostic codes.
- Quarantine unknown, malformed, dangling, and conflicting records from causal
  coverage, exact-resolution lookup, and portable export without rewriting the
  source notes.
- Add deterministic `vcs-lab.metadata-envelope/v1` directories containing a
  hashed manifest and a sanitized Git bundle for notes and exact-resolution
  refs; tracked specs continue to travel with ordinary project content.
- Define clone/fork lineage with Git object format plus sorted root-commit
  anchors. Exact lineage or a shared root is import-compatible; unrelated and
  history-filtered lineages fail closed in envelope v1.
- Add import dry-run/apply with payload verification, exact record/ref/object
  previews, conflict refusal, staged refs, atomic final ref transactions, and
  idempotent repeated import.
- Explicitly exclude workspace paths, checkpoint refs, active reconciliation
  journals, and saved forecasts from portable envelopes and retain the
  distinction between integrity, cryptographic trust, and authorization.
- Add two disposable-repository integration scenarios covering damaged record
  quarantine, coverage safety, deterministic export, tamper rejection,
  unrelated-lineage rejection, conflict-safe dry runs, two-clone round trips,
  causal-plan/resolution/spec parity, idempotence, and local/private exclusion.

## 0.7.1

- Add a full product requirements document with predecessor lessons, AI-agent
  and specification use cases, guiding principles, identified functional and
  non-functional requirements, acceptance signals, success metrics, release
  gates, roadmap criteria, risks, and open questions.
- Add a current architecture reference covering components, identity and
  persistence models, versioned schemas, causal planning, landing, forecast,
  reconciliation, resolution, workspace, specification, Git-session, failure,
  trust, performance, and extension boundaries.
- Add an architecture decision record process and ten initial ADRs: nine
  accepted decisions for the v0.7 implementation and one proposed metadata
  integrity/portability direction.
- Add a self-contained new-session handoff with the preserved product intent,
  Windows repository path, release history, source/runtime maps, invariant
  checklist, baseline commands, known risks, a detailed candidate v0.8 track,
  release discipline, and a copy/paste continuation prompt.
- Add an explicit documentation authority/navigation map and clarify that the
  earlier design notes are historical rationale rather than the sole current
  product contract.

## 0.7.0

- Add a worktree-scoped persistent `git cat-file --batch-command` session for
  immutable object reads during planning, forecasting, and reconciliation.
- Enable the session automatically on Windows, where measured Git process
  startup dominates latency; retain explicit `--git-session` and
  `--no-git-session` controls on every command.
- Cache only full object-ID expressions, invalidate session state after
  mutations, isolate sessions by worktree path, and fall back to ordinary Git
  processes if the persistent worker becomes unavailable.
- Batch target and source commit metadata into two `git log` operations instead
  of spawning `git show` once per commit, keeping planning process count
  independent of branch length.
- Batch note-object reads and use one reachability walk rather than one ancestry
  and note process per causal record.
- Resolve related head/tree probes together and read cherry-pick state directly
  from each worktree's private Git directory.
- Distinguish logical Git queries, actual process launches, persistent-session
  queries, and immutable-object cache hits in forecasts, receipts, doctor
  output, and `--trace-git` diagnostics.
- Extend `vlab doctor --benchmark` with an object-session probe and add
  `npm run demo:git-session`, which verifies identical forecasts while
  comparing persistent and ordinary process counts.
- Reduce the 12-change forecast demo from 52 ordinary Git processes to 25
  processes (51.9% fewer on the release test host), while the deterministic
  spec reconciliation application uses 6 processes for 10 logical queries.
- Expand the integration suite to 29 tests and run it in both persistent and
  ordinary plumbing modes, including forced worker-failure fallback and
  multi-worktree forecast isolation.

## 0.6.0

- Replace expanded v2 specification sidecars with sparse v3 manifests that
  persist only artifact/source identity, entity count, parser identity, Git
  blob identity when available, and exceptional stable-ID overrides.
- Derive titles, positions, content hashes, and ordinary entity IDs directly
  from canonical Markdown while keeping `vlab spec show` fully materialized.
- Migrate v1/v2 manifests on the next index without changing their logical
  entity IDs; only non-derived legacy IDs remain as compact overrides.
- Use Git index blob identities for repository-wide incremental indexing, so
  unchanged tracked documents need no filesystem read or content hash.
- Batch all base/target/source Markdown and manifest reads through one
  `git cat-file --batch` process and batch staged-result verification the same
  way.
- Batch applied commit/tree identity probes and raise the Git output ceiling for
  large documentation objects.
- Upgrade the corpus benchmark to compare sparse v3 metadata against an
  equivalent v2 representation and report blob-cache hits, content reads,
  bytes per entity, and raw/compressed reduction percentages.
- Reduce the representative 25-document, 2,025-entity corpus from 655,545
  equivalent v2 metadata bytes to 11,240 v3 bytes (98.29% less), while the
  semantic reconciliation integration path uses at most 10 Git subprocesses.
- Expand the integration suite to 28 tests, including v2 migration, sparse
  persistence, zero-read unchanged indexing, and subprocess-count regression
  coverage.

## 0.5.0

- Add deterministic three-way reconciliation for indexed Markdown using stable
  preamble and heading-block identities.
- Combine independent block edits and move-plus-edit cases while keeping
  divergent same-block edits, delete-versus-edit, and incompatible ordering as
  explicit blockers.
- Integrate semantic decisions into disposable forecasts, pin their exact input
  signatures and output hashes, and batch-apply them only through a reviewed
  forecast.
- Add `vlab spec status` and `vlab spec resolve` for explicit application during
  a paused non-forecast reconciliation, with semantic decisions preserved in
  application and reconciliation receipts.
- Upgrade spec manifests to deterministic v2 metadata with cross-branch entity
  IDs, canonical LF rendering, and no generation timestamp.
- Make unchanged source hashes true cache hits and add `vlab spec index --all`
  for incremental repository-wide indexing.
- Add `vlab spec merge-plan` for direct three-revision inspection and
  `vlab spec benchmark` for generated-corpus latency and storage measurements.
- Add forecast phase timings and Git subprocess counts grouped by command.
- Add configurable benchmark warmup/sample counts plus min, median, p95,
  average, and max latency.
- Add a deterministic spec-merge demo and expand the integration suite to 27
  tests.

## 0.4.0

- Add `vlab forecast <source>` to simulate proven-new changes in a disposable
  detached worktree without changing the caller's HEAD, index, or files.
- Predict clean applications, exact reusable resolutions, blocking conflicts,
  partial trees, complete result trees, and final state equality.
- Persist forecasts privately per worktree and pin them to source and target
  heads plus a complete causal merge-plan fingerprint.
- Add `vlab reconcile --use-forecast <id>` to batch-apply only the exact
  resolution IDs reviewed in that forecast.
- Recheck conflict signatures during application and verify a complete
  reconciliation's final tree against its forecast before publishing receipts.
- Add `vlab workspace forecast <target> <source>` for committed-head comparison
  between agent worktrees while explicitly reporting ignored dirty drafts.
- Record forecast IDs, exact-selection method, active application time, and
  elapsed wall time in reconciliation metadata.
- Add a proactive forecast demo and expand the integration suite to 19 tests.

## 0.3.0

- Fingerprint conflicts with an exact, path-independent three-way signature
  derived from Git's base, ours, and theirs blob identities.
- Store completed conflict resolutions in repository-shared, garbage-collection
  safe refs and suggest them when the same conflict recurs in another worktree.
- Add `vlab resolve status`, `apply`, `reject`, and `list` with explicit handling
  for ambiguous resolution variants.
- Record whether a suggestion was created, accepted unchanged, modified, or
  rejected in application and reconciliation receipts.
- Keep resolution reuse conservative: suggestions are visible but never applied
  until the user asks.
- Make reconciliation output concise by default while retaining complete JSON
  through `--json`.
- Consolidate matching application and reconciliation edges in `vlab graph`.
- Add opt-in Git subprocess timings with `VLAB_TRACE=1` and repeatable local
  probes through `vlab doctor --benchmark`.
- Add a reusable-resolution/worktree demo and expand the integration suite to
  15 tests.

## 0.2.1

- Make disposable test and demo repositories deterministic on Windows by
  disabling checkout-time CRLF conversion locally.
- Normalize line endings in assertions where exact newline bytes are not part
  of the behavior under test.
- Add repository line-ending policy through `.gitattributes`.

## 0.2.0

- Add worktree-local, durable reconciliation operations.
- Add `vlab reconcile --status`, `--continue`, and `--abort`.
- Record contextual applications after user-resolved conflicts.
- Allow `--continue --fork` when a resolution changes logical intent.
- Keep partial application records private until reconciliation completes.
- Restore the original target and discard pending receipts on abort.
- Distinguish state equality before and after reconciliation.
- Hide Git notes history in `vlab graph` and improve causal edge output.
- Leave the standard demo worktree clean and add `npm run demo:conflict`.

## 0.1.0

- Initial Git-backed causal source-control laboratory.
- Stable Change IDs, compact and hard-squash landings, causal merge planning,
  worktree-backed workspaces, checkpoints, and annotated Markdown specs.
