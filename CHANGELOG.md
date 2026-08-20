# Changelog

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
