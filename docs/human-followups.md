# Required human follow-ups

Every required human action left by agent-completed work must be recorded as a
follow-up issue in the designated **private repository**, added to its **private
project board**, and documented with step-by-step instructions in that private
repository's wiki. A final-answer reminder, public issue label, local draft, or
board card alone does not fulfill this requirement.

Apply this when completing implementation, shipping changes, updating docs, or
ending a session. Examples include an owner decision, access to a real host,
manual setup, credential configuration, validation on unavailable hardware, or
user/workflow evidence required to qualify the delivered work. Do not invent
human approval gates for work the agent can complete under existing authority.

## Resolve the private destinations

Use the destinations the user already supplied in the session or approved
project configuration. Resolve all three explicitly: issue repository
(`owner/repo`), project owner/number, and wiki repository. Verify the issue
repository and wiki's parent repository are private and the project is private
before writing. GitHub wikis inherit their parent repository's visibility; a
private project does not make a public issue or public wiki private.

Do not infer the destination from the current clone or use its public issue
tracker/wiki as a fallback. Use explicit `gh --repo owner/repo` arguments for
issue operations and explicit project identifiers for board operations. Do not
change repository visibility or create a new repository to satisfy this policy
without user authorization.

If the destination is missing, public, inaccessible, or lacks the required wiki
or project access, prepare the complete issue body and wiki procedure in a local
scratchpad outside the tracked tree. Ask for the missing destination or access,
explaining the verified obstacle. Reuse an already-pending question; do not ask
again each time a skill runs. Continue independent authorized work, but report
the private handoff as incomplete until the issue, board item, and wiki page are
published and verified. Never expose secrets in drafts or published procedures;
name the secret input and its approved source instead of recording its value.

## Create or update the follow-up issue

Search the designated private repository first. Reuse an issue covering the same
action; otherwise create one issue per independently completable human action.
A public implementation issue may be linked from the private follow-up, but it
does not replace the required private issue. Preserve existing public records;
do not migrate, delete, or expose private details through public backlinks.

The issue must include:

- the concrete human action, why it remains necessary, and the completed work
  that produced it (source issue, PR, commit, or release);
- the responsible person if known, otherwise the required role, without guessing
  an assignee;
- prerequisites, access/environment needs, dependencies, and when it must happen
  (for example, before release qualification);
- acceptance criteria, expected evidence, and where to retain that evidence;
- a link to the private wiki procedure.

Apply `human-action-required` (create it if absent) and add the issue to the
verified private board. Set Status, Gate, and Area where those fields exist,
reflecting the actual dependency rather than closing or activating work merely
because its documentation exists. Preserve other labels and fields.

## Write the private wiki procedure

Create or update a procedure page and link it from the private wiki's
`Human TODO` page (use `human-todo` when creating that page). An existing
`Human TODO` page may hold the steps directly when the action is short. Link each
entry to its canonical private issue; the issue remains the source of status,
ownership, and completion evidence rather than a second independent backlog.

Each procedure must provide:

1. **Purpose and owner role:** the outcome and who has the necessary access.
2. **Prerequisites:** machines, accounts, versions, access, inputs, and any work
   that must finish first.
3. **Numbered execution steps:** exact commands or UI paths, the directory/host
   where they run, clearly marked values to substitute, and the expected result
   of each meaningful step. "Ask the owner" or "run the benchmark" alone is not
   a procedure.
4. **Verification:** explicit pass/fail conditions and evidence to attach to the
   issue. Distinguish partial or skipped validation from qualification.
5. **Failure handling and cleanup:** when to stop, what to preserve, and how to
   recover or remove disposable resources where applicable.
6. **Completion:** record evidence and the decision on the issue, resolve the
   human-action label when satisfied, and update the board and wiki index to
   point to the completed outcome. Do not close the follow-up merely because
   the agent's implementation merged.

If a step needs a human decision, document the concrete options and their
consequences, what input is needed, and how to record the choice. For repeated
runs, update the existing procedure instead of creating session-specific copies.

## Verify and report the handoff

Read back the private issue, its label and board membership/fields, and the
published wiki procedure and index link using authenticated access. Confirm the
issue and procedure link to each other and the destinations are still private.
A local wiki commit without a successful push is not publication. Update an
existing issue/page pair instead of creating duplicates on a partial retry.

Report the issue, board, and wiki links to the authorized user with the remaining
human action and timing. Keep private URLs and details out of public PRs, source
files, public wiki pages, and CI logs unless the user explicitly authorizes
that disclosure. Source implementation may be complete while its human follow-up
remains open; state both accurately. If no human action remains, say so without
creating filler issues or wiki pages.
