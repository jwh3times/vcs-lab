# Changelog

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
