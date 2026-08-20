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
- users value causal and semantic queries enough to justify metadata complexity.
