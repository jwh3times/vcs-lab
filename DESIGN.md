# vcs-lab design notes

## Purpose

The prototype tests whether three additional identities are enough to repair common Git workflow problems without breaking Git compatibility:

1. `Change-Id` — stable logical intent across rewritten commits.
2. application record — a target-specific realization of a change.
3. landing receipt — proof that a target incorporated exact source revisions.

Git commit IDs and tree IDs remain the exact immutable state identities.

## Compact versus hard-squash landing

`compact` creates a conventional two-parent Git merge commit. It is compact only in the display graph: first-parent history contains one landing unit. The second parent provides stock Git with correct causal reachability.

`hard-squash` creates a conventional one-parent Git squash commit and attaches a receipt containing the source head, exact absorbed commits, stable Change IDs, before/after revisions, base, and resulting tree. Native planning can use that causal edge; stock Git cannot.

## Reconciliation algorithm in the lab

For every source commit outside the physical Git merge base:

1. exact commit ancestry proves coverage;
2. a reachable landing receipt containing the commit proves coverage;
3. the same stable Change ID in target history proves logical coverage in this single-user lab;
4. a receipt containing the Change ID proves coverage;
5. Git patch equivalence creates an advisory candidate;
6. otherwise the change is new.

Only proven-new changes are applied. Heuristic candidates force a user decision. A production protocol would trust stable identity only when issued or attested by an authorized actor.

## Resumable reconciliation operation

Version 0.2 introduced an operation journal written before applying the first
change. The journal pins the source head, target-before commit, complete merge
plan, ordered application queue, completed applications, and current conflict.
It is stored in the current worktree's private Git directory rather than the
common repository directory.

Clean applications remain provisional in the journal until the entire operation completes. This allows `--abort` to restore the original target without leaving receipts for commits that are no longer reachable. On completion, application records and a reconciliation receipt are published to Git notes.

A conflict resolution has two identities:

- `contextual-application` retains the source Change ID while recording a different result tree;
- `contextual-fork` creates a derived Change ID and deliberately does not mark the original source intent as covered.

This makes causal coverage and exact tree equality independent. A target can cover every source intent while realizing it differently, or it can derive a new intent while leaving the original source change unapplied.

## Reusable conflict resolutions

Version 0.3 adds a deliberately conservative resolution-memory layer. When a
cherry-pick conflicts, the index contains up to three entries for each path:
merge base, target (`ours`), and source (`theirs`). The lab hashes the ordered
triplet of each entry's file mode and blob ID using
`ordered-three-way-blobs/v1`. The file path is excluded, so an exact conflict
can be recognized after a rename or in a separate worktree.

This signature proves byte-for-byte equality of the three conflict inputs; it
does not claim semantic equivalence. A matching resolution is therefore a safe
candidate to present, but v0.3 never mutates the worktree automatically. The
user must run `vlab resolve apply`, may edit the result before continuing, or
may explicitly reject it. If multiple result blobs have been recorded for the
same signature, selection requires a resolution ID.

The completed application records one of four decisions:

- `created` — this exact conflict had no prior candidate;
- `accepted` — a prior result was staged unchanged;
- `modified` — an applied suggestion was changed before continuation;
- `rejected` — prior candidates were declined and another result was used.

Resolution records are Git notes attached to small hidden commits under
`refs/vcs-lab/resolutions/<signature>/<result-blob>`. Each commit retains the
result blob in its tree, making it safe from normal Git garbage collection.
The catalog is common to linked worktrees while each pending choice remains in
that worktree's reconciliation journal.

This is closer to exact `rerere` with explicit provenance than to an AI merge
system. Later experiments can add semantic or learned candidates as a lower
confidence tier without weakening the exact tier.

## Performance observation

The prototype still invokes stock Git as subprocesses. `VLAB_TRACE=1` reports
the duration of each Git command without logging user content, and
`vlab doctor --benchmark` samples common repository probes. These measurements
provide a baseline for deciding whether a native daemon, long-lived object
service, or virtualized workspace layer is justified, especially in large
OneDrive-hosted repositories.

## Workspace checkpoint

The checkpoint command creates a temporary Git index, reads `HEAD` into it, adds the current working tree, writes a tree, and uses `git commit-tree` to create an immutable checkpoint. The real index and worktree are untouched. A hidden ref prevents garbage collection.

This is a useful approximation of the proposed native operation log and copy-on-write workspace overlay.

## Hybrid specifications

The lab begins with annotated files, not native structured documents. Exact Markdown bytes remain authoritative. A portable sidecar assigns stable IDs to headings and `REQ-*:` records, demonstrating entity-aware history and review anchoring without requiring new editors.

The next step would be a deterministic three-way block merge using those IDs, followed by an opt-in structured specification whose canonical form renders deterministically to Markdown.

## Exit criteria for a second prototype

Build a native store only if local trials show that:

- compact landing is accepted as a better default than hard squash;
- causal receipts measurably prevent duplicate/conflicting back-merges;
- stable Change IDs improve rebase, cherry-pick, and review continuity;
- workspace checkpoints and conflict forecasts help parallel agents;
- annotated spec entities remain stable enough under real editing;
- users value causal and semantic queries enough to justify metadata complexity;
- exact resolution reuse removes repeated conflict work without encouraging
  unsafe automatic merges;
- subprocess and filesystem measurements identify a material performance limit
  that a native layer can address.
