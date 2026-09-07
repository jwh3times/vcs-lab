---
name: docs-updater
description: Update vcs-lab README, durable documentation, and wiki guidance after implemented changes; capture required human actions as private issue, board, and wiki follow-ups. Use when asked to update docs or reconcile documentation with completed work.
---

# Docs updater

Announce that you are using this skill. Read `AGENTS.md` and
`docs/README.md` before editing, and inspect the implemented behavior and relevant
issues/PRs so the documentation describes the delivered contract.

## Update the relevant surfaces

- Update README usage and the authoritative testing, architecture, product,
  schema, or ADR documents affected by the change. Update navigation so the
  instructions are discoverable; avoid copying the full contract into every page.
- Inspect the corresponding wiki pages and update current usage guidance. Keep
  dated audit findings historical and link them to current instructions.
- Record shipped behavior in the changelog when appropriate. Keep run-specific
  evidence and future implementation work on issues or CI artifacts.

## Required human actions

Before reporting documentation complete, apply
[the required human follow-up policy](../../../docs/human-followups.md) to every
human action left by the completed work. Create or reuse a follow-up issue in
the designated private repository, label it `human-action-required`, put it on
the verified private board, and publish a linked, numbered procedure in the
private wiki with an entry on `Human TODO`.

The policy defines issue contents, execution/verification/recovery steps,
privacy checks, deduplication, and publication verification. A public issue or
wiki is not a substitute. If the private destination is unavailable, finish the
reviewable draft outside the tree and report the handoff as pending, using any
existing destination question rather than asking again. Continue independent
documentation work. Do not manufacture approval requirements or duplicate
already-tracked actions.

## Validate and report

Run `npm run test:docs` and `git diff --check`; check wiki navigation and links
against their intended repositories. When skills change, run
`npm run sync:agents` followed by `npm run sync:agents -- --check`; never edit
`.claude/skills/` directly. Use the user's existing shipping authorization.
Verify published docs and the private issue/board/wiki records before claiming
completion. Report changed pages, validation, and any remaining human actions
with private links only in the authorized user's conversation.
