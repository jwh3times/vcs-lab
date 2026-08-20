# Changelog

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
