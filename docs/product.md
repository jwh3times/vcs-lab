# Product Requirements Document: vcs-lab

## Document control

| Field | Value |
| --- | --- |
| Product | `vcs-lab` / causal source-control laboratory |
| Document version | 1.0 |
| Product baseline | v0.9.0 release |
| Status | Active product baseline |
| Last updated | 2026-08-28 |
| Primary audience | Maintainers, contributors, protocol designers, and AI coding agents |
| Decision owner | Repository maintainers |

This document defines what the product is intended to become, which behaviors
are required, and how progress is judged. [architecture.md](architecture.md)
describes how the current implementation works. Accepted architectural
decisions live in [adr](adr/README.md). Where documents disagree, the order of
authority is:

1. an accepted or superseding ADR for the specific decision;
2. this PRD for product intent and requirements;
3. `architecture.md` for the implemented system;
4. tests and executable schemas for exact current behavior;
5. `README.md` and changelog narrative.

## 1. Executive summary

`vcs-lab` is a Git-compatible laboratory for a modern source-control model. It
keeps Git's object model, repositories, branches, commits, worktrees, and
interoperable command-line behavior while testing additional causal and
semantic information that Git does not preserve reliably through squash,
rebase, cherry-pick, and parallel AI-agent workflows.

The central product hypothesis is that source control needs more than commit
ancestry. A useful modern system must distinguish:

- immutable repository state;
- the logical intent of a change;
- a target-specific application of that intent;
- proof that a landing absorbed particular source work;
- a workspace and its private in-progress operation state;
- stable semantic entities inside high-volume specifications.

The prototype must remain useful with ordinary Git at every step. It may add
metadata and stronger planning, but it must not make a repository unreadable,
unrecoverable, or unworkable when `vlab` is absent. A native store, service, or
wire protocol is justified only after local experiments establish that the
semantics are correct and valuable.

## 2. Problem statement

### 2.1 Problems inherited from Git workflows

Git is the industry compatibility standard, but several behaviors are a poor
fit for long-lived, heavily rewritten, parallel development:

- A commit ID identifies one exact state transition and parent list, not a
  stable logical change. Rebase, amend, and cherry-pick create new IDs.
- A hard squash deliberately removes source ancestry. Later merging the source
  branch back can replay work the target already contains, even when the trees
  are nearly or exactly equal.
- Patch similarity can identify likely equivalence, but cannot safely prove
  intent and is unsuitable for silent suppression.
- Conflict resolution is reactive. Git can remember textual resolutions, but
  it does not expose a rich, portable, reviewable decision with source and
  target context.
- Forecasting a complete merge or rebase without disturbing the caller's
  worktree generally requires custom scripting.
- Linked worktrees are powerful for parallel agents, but Git does not model
  higher-level workspace ownership, focus, checkpoints, or handoff state.
- Line-oriented merging treats documents as undifferentiated text even when
  headings and requirements are stable semantic entities.

### 2.2 Problems inherited from centralized systems

SVN demonstrated advantages that remain relevant: a simple global history,
cheap conceptual checkout/update, server-enforced policy, and predictable
identity. It also demonstrated the costs of central coordination, network
dependence, path-oriented branching, limited offline operation, and weaker
local experimentation.

The desired product must not trade Git's local autonomy and content-addressed
integrity for a mandatory central server. Central services may later provide
trust, policy, and coordination, but the core model must remain locally
inspectable and operable.

### 2.3 New pressure from specification-driven AI development

AI development increases both concurrency and durable documentation volume:

- Multiple agents commonly use one linked worktree each.
- Agents produce plans, specifications, acceptance criteria, traces, and
  generated documentation in addition to code.
- Branches are short-lived but numerous, and their commits are frequently
  rewritten or squash-landed.
- Agents need safe previews and machine-readable explanations before mutation.
- Repeated conflicts should be reusable only when their inputs are proven
  identical or a lower-confidence decision is explicitly approved.
- A large documentation corpus cannot afford expanded sidecars that duplicate
  every title, position, and hash in every revision.
- Stable entity IDs are needed for review comments, requirements traceability,
  and incremental processing across edits and moves.

## 3. Product thesis

The product will first prove a **causal compatibility layer over Git**:

1. Git remains the exact state store and universal escape hatch.
2. Stable logical identities survive safe history rewriting.
3. Landing and application receipts add causal edges that topology lost.
4. Planning subtracts only work supported by exact evidence.
5. A forecast makes the full intended operation reviewable before mutation.
6. Worktree-local journals make interruption and multi-agent concurrency safe.
7. Deterministic semantic merge handles structured documents before any model
   is allowed to make a judgment.
8. Performance is measured in logical work, process launches, content reads,
   storage bytes, and elapsed time before a native subsystem is proposed.

If these semantics prove useful, a later implementation may introduce a native
metadata database, long-lived service, protocol gateway, or structured object
format while retaining the same observable contracts.

## 4. Goals

### 4.1 Primary goals

- Preserve normal Git branching, commit, merge, cherry-pick, rebase, worktree,
  fetch, and recovery workflows.
- Make compact merging easy while retaining causal truth whenever possible.
- Make hard-squash continuation and back-merge planning safe through explicit
  causal receipts.
- Preserve logical change identity across rebase and cherry-pick and make an
  intentional divergence explicit.
- Provide an explainable merge plan that separates proven coverage, advisory
  equivalence, and new work.
- Forecast reconciliation in isolation and pin every exact automated decision.
- Resume or abort conflicts across processes without losing causal context.
- Reuse exact conflict resolutions across branches and worktrees with explicit
  provenance and user approval.
- Treat linked worktrees as first-class agent workspaces with isolated private
  state and non-disruptive checkpoints.
- Give specification entities stable identity while keeping Markdown canonical
  and metadata sparse.
- Combine independent specification edits deterministically and block ambiguous
  same-entity changes.
- Collect evidence about latency, subprocess cost, metadata size, and content
  reads to guide later architecture.

### 4.2 Adoption goals

- A Git user can try the system in an existing local repository without
  migrating repository contents.
- A user who stops using `vlab` retains an ordinary, usable Git repository.
- Every important operation has human-readable output and machine-readable JSON
  where automation needs it.
- The tool behaves predictably on Windows, macOS, and Linux, with special
  attention to Windows process startup, CRLF conversion, and OneDrive-hosted
  repositories.

## 5. Non-goals for the current prototype

The v0.x laboratory does not claim to provide:

- a production-ready replacement for Git;
- a hosted forge, code-review product, or authorization service;
- cryptographic trust for locally generated receipts;
- automatic remote synchronization of all causal metadata;
- a native content-addressed database or wire protocol before Gate B of the
  native implementation gate (§15);
- virtual or lazy filesystem materialization before Gate B;
- safe AI-authored conflict resolution without explicit review;
- semantic merge for arbitrary programming languages or binary documents;
- requirement-level byte merging nested inside a heading section;
- forecasting of live uncommitted drafts as though they were committed causal
  state; explicitly captured immutable checkpoints remain a distinct input;
- server-side policy, atomic multi-ref landing, or protected-branch enforcement;
- compatibility with every Git implementation or hosting provider during the
  laboratory phase.

These are candidates for later phases, not hidden assumptions in current
requirements.

## 6. Users and jobs to be done

### 6.1 Individual developer

**Needs:** familiar Git behavior, easy branching, understandable planning, safe
recovery, and no repository lock-in.

**Job:** “Let me land, backport, rewrite, and reconcile work without replaying a
logical change merely because its commit IDs changed.”

### 6.2 AI coding agent

**Needs:** an isolated worktree, a pinned base, machine-readable status, cheap
checkpointing, deterministic automation, and a resumable handoff.

**Job:** “Give me a private workspace and let me preview or pause a multi-step
integration without corrupting another agent's operation.”

### 6.3 Reviewer or maintainer

**Needs:** a compact first-parent history, traceable absorbed changes, explicit
heuristic decisions, reproducible forecasts, and auditable resolutions.

**Job:** “Show me exactly why work is considered covered and what will change
before I authorize integration.”

### 6.4 Specification owner

**Needs:** readable Markdown, stable requirement anchors, independent-block
merging, small metadata, and deterministic behavior.

**Job:** “Allow many people and agents to edit different parts of a large spec
without manufacturing conflicts or replacing the document with an opaque
database.”

### 6.5 Tooling or CI author

**Needs:** stable schemas, JSON output, deterministic exit behavior, explicit
metadata transport, and performance counters.

**Job:** “Integrate the causal model into automation without scraping prose or
trusting an unversioned side effect.”

### 6.6 Repository administrator (future)

**Needs:** verified receipt provenance, retention, policy enforcement, schema
compatibility, and atomic synchronization.

**Job:** “Know which causal claims are trusted, portable, and enforceable across
clones and servers.”

## 7. Guiding principles

The following principles are normative. A change that violates one requires an
ADR that explains why.

| ID | Principle | Consequence |
| --- | --- | --- |
| GP-01 | Git compatibility before replacement | Every v0.x state-changing operation produces valid Git objects and leaves standard recovery commands available. |
| GP-02 | Identity is plural | Commit, tree, logical change, application, landing, workspace, and semantic entity identities must not be collapsed into one identifier. A content-addressed record identity (such as a fact digest) identifies a claim, never a tree, commit, or intent. |
| GP-03 | Exact proof outranks similarity | Ancestry, stable IDs, and receipts may prove coverage; patch similarity remains advisory. |
| GP-04 | No silent heuristics | A lower-confidence equivalence or merge decision must be shown and explicitly accepted. |
| GP-05 | Forecast before broad mutation | Multi-change and automatically resolved operations should be inspectable and pinned before application. |
| GP-06 | Private operation state, shared durable facts | A paused operation belongs to one worktree; completed receipts and reusable exact resolutions belong to the repository. |
| GP-07 | Deterministic before probabilistic | Exhaust exact and deterministic semantic rules before considering model-assisted judgment. |
| GP-08 | Canonical source stays human-usable | Markdown is authoritative; indexes and sidecars are derived, sparse, and rebuildable where possible. |
| GP-09 | Every optimization preserves semantics | Performance paths must produce the same plan, decisions, tree, and receipts as the ordinary Git path. |
| GP-10 | Mutation is recoverable | Operations either complete with durable records, pause with sufficient context, or abort to the exact starting commit. |
| GP-11 | Trust is explicit | A record being present is not equivalent to it being signed, authorized, or server-approved. |
| GP-12 | Measure before replacing | Native storage, daemons, and protocol components require evidence from the compatibility layer. A semantics-preserving alternative engine may exist behind an equality-tested seam before any replacement decision (§15 Gate A). |

## 8. Product terminology and identity model

| Term | Meaning | Current representation |
| --- | --- | --- |
| Commit identity | Exact snapshot plus parents, authoring, and message identity | Git commit OID |
| State identity | Exact repository tree | Git tree OID |
| Logical change | Intent intended to survive safe rewriting | `Change-Id` trailer (`ch_*`) |
| Application | A realization of a source change in a particular target context | Application receipt |
| Landing | Integration event that absorbs a set of source revisions | Merge/squash commit plus landing receipt |
| Causal edge | Evidence that a target includes or applied source work despite missing physical ancestry | Git parent or receipt relation |
| Forecast | Non-mutating simulation pinned to exact inputs and decisions | Worktree-private forecast record |
| Reconciliation | Application of only work not proven covered | Worktree journal plus final receipt |
| Resolution | Exact result for an ordered base/target/source conflict signature | Resolution record plus retained result blob |
| Workspace | Logical agent/developer context with base, focus, owner, and lifecycle | Registry entry plus compatibility branch/worktree |
| Checkpoint | Immutable capture of workspace files without changing its index or `HEAD` | Hidden Git commit/ref |
| Specification artifact | Canonical document with persistent artifact identity | Markdown plus sparse manifest |
| Semantic entity | Stable preamble, heading section, or explicit requirement | Derived/overridden entity ID |

## 9. Functional requirements

Priorities use **P0** (required invariant), **P1** (core product), **P2**
(important expansion), and **P3** (exploratory). Status is **Implemented**,
**Partial**, **Planned**, or **Deferred** at the v0.9.0 release baseline.

### 9.1 Git compatibility and repository adoption

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-GIT-01 | P0 | The tool shall operate inside a normal Git repository without converting existing Git objects. | Implemented | `vlab init` leaves an existing clean worktree clean. |
| FR-GIT-02 | P0 | Commits, landings, applications, and checkpoints shall be valid Git objects inspectable with stock Git. | Implemented | `git fsck`, `git log`, `git show`, and `git cat-file` can inspect produced objects. |
| FR-GIT-03 | P0 | Users shall retain stock Git recovery paths during conflicts. | Implemented | Paused operations expose Git cherry-pick state and document continue/abort behavior. |
| FR-GIT-04 | P1 | Ordinary branches and linked worktrees shall remain usable alongside `vlab`. | Implemented | Git can switch, fetch, and inspect branches without `vlab`. |
| FR-GIT-05 | P1 | Repository initialization shall configure causal-note display and rewrite behavior without modifying tracked files. | Implemented | Integration test verifies clean status after initialization. |
| FR-GIT-06 | P1 | Human-readable output shall have a JSON equivalent for state needed by automation. | Partial | Core plans, receipts, forecasts, workspaces, specs, and operations support JSON; a formal CLI schema catalog remains planned. |
| FR-GIT-07 | P1 | The CLI shall accept explicit compatibility/performance controls without changing domain semantics. | Implemented | `--git-session` and `--no-git-session` produce equality-checked forecasts. |
| FR-GIT-08 | P2 | A supported metadata synchronization command shall move all required causal records between clones. | Implemented experimentally | Fresh-clone round-trip reproduces coverage, resolution catalog, and spec identity without manual ref knowledge. |

### 9.2 Logical change identity

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-ID-01 | P0 | A new logical change shall receive a stable unique `Change-Id`. | Implemented | `vlab commit` writes a `ch_*` trailer. |
| FR-ID-02 | P0 | Rebase and same-intent cherry-pick shall preserve the logical ID. | Implemented | Cherry-pick and supervised causal rebase preserve the source Change ID; integration tests inspect the rewritten commit and application receipt. |
| FR-ID-03 | P0 | An intentional semantic divergence shall create a new logical ID and record its origin. | Implemented | `vlab cherry-pick --fork` and conflict continuation `--fork` record derived identity. |
| FR-ID-04 | P1 | Reapplying a covered logical change shall default to a no-op unless repetition is explicitly requested. | Implemented | `vlab cherry-pick` detects coverage; `--repeat` overrides. |
| FR-ID-05 | P1 | Commits without a `Change-Id` shall remain addressable without inventing an unverifiable stable identity. | Implemented | Fallback identity is `git:<commit-oid>`. |
| FR-ID-06 | P2 | Identity collision and duplicate-origin diagnostics shall be available repository-wide. | Planned | Audit reports conflicting trailers and ambiguous origin chains. |
| FR-ID-07 | P2 | The protocol shall specify namespace, entropy, and cross-repository import behavior for logical IDs. | Planned | Versioned protocol schema and collision tests exist. |

### 9.3 Branching, landing, merge, rebase, and squash recovery

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-LAND-01 | P0 | Creating a branch shall remain as easy as ordinary Git branch creation. | Implemented | `vlab branch <name> [from]` creates and switches to a Git branch. |
| FR-LAND-02 | P0 | The recommended compact landing shall present one first-parent unit while retaining the source as a real causal parent. | Implemented | Compact landing has two parents and one first-parent entry. |
| FR-LAND-03 | P0 | A strict hard squash shall record the exact source head, base, absorbed commits, logical IDs, target, and result tree. | Implemented | Landing receipt schema v1 is attached to the squash commit. |
| FR-LAND-04 | P0 | Continued work on a hard-squashed source shall not replay work proven absorbed. | Implemented | Merge plan suppresses absorbed changes and applies only the continuation. |
| FR-LAND-05 | P0 | Near-identical branches shall not be declared equal solely because commit topology differs or patch similarity matches. | Implemented | Tree equality is reported separately; similarity is a candidate requiring acceptance. |
| FR-LAND-06 | P1 | Exact target/source tree equality shall be visible even when history differs. | Implemented | Merge plan reports `same state`. |
| FR-LAND-07 | P1 | Landing messages shall retain portable trailers for mode, source revision, and absorbed logical changes. | Implemented | Git commit message is useful even when notes are not fetched. |
| FR-LAND-08 | P1 | A landing that conflicts before commit shall publish no false receipt. | Implemented | Conflict exits without receipt creation. |
| FR-LAND-09 | P2 | Rebase planning shall use the same coverage model and preserve logical application provenance. | Implemented experimentally | [ADR-0011](adr/0011-model-causal-rebase-as-a-forecasted-application-sequence.md) is Accepted; plan, forecast, supervised application, recovery, and portable completed receipts are integration-tested for linear v1. |
| FR-LAND-10 | P2 | A higher-level landing transaction shall eventually support policy checks and atomic publication. | Deferred | Requires a trusted coordinator or protocol gateway. |

### 9.4 Causal merge planning

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-PLAN-01 | P0 | A plan shall classify each relevant source change as `covered`, `candidate-equivalent`, or `new`. | Implemented | `vlab merge-plan` emits all three statuses and counts. |
| FR-PLAN-02 | P0 | Coverage shall cite its proof: physical ancestry, stable identity, landing receipt, reconciliation receipt, or another versioned exact proof. | Implemented | Each covered change includes a proof label. |
| FR-PLAN-03 | P0 | Patch equivalence shall remain advisory and never silently suppress a change. | Implemented | Candidate presence requires `--accept-candidates`. |
| FR-PLAN-04 | P0 | The physical merge base and best proven causal/effective base shall both be visible. | Implemented | Plan prints both bases and receipt source. |
| FR-PLAN-05 | P0 | Coverage shall be limited to receipts reachable from the target, not arbitrary repository metadata. | Implemented | Receipt scan filters by target reachability. |
| FR-PLAN-06 | P1 | Planning shall be deterministic for fixed Git objects and metadata refs. | Implemented | Forecast fingerprint and integration tests detect changes. |
| FR-PLAN-07 | P1 | Branch length shall not cause one process launch per commit in common planning paths. | Implemented | Target and source histories are read through bounded log operations. |
| FR-PLAN-08 | P2 | Plans shall expose a versioned portable proof bundle suitable for a remote verifier. | Planned | Independent verifier reproduces classification without trusting CLI prose. |

### 9.5 Forecasting and reconciliation

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-REC-01 | P0 | Forecasting shall not change the caller's `HEAD`, index, or working files. | Implemented | Before/after invariants are checked and tested. |
| FR-REC-02 | P0 | A forecast shall pin source and target heads/trees, plan fingerprint, decisions, and predicted tree when complete. | Implemented | Forecast schema v2 stores exact inputs and outputs. |
| FR-REC-03 | P0 | Reconciliation shall apply only changes classified as new plus explicitly accepted candidates. | Implemented | Queue is built from reviewed plan statuses. |
| FR-REC-04 | P0 | A stale forecast shall fail before mutation. | Implemented | Changed head or plan causes a preflight error. |
| FR-REC-05 | P0 | Real application shall revalidate forecasted conflict signatures and selected result objects. | Implemented | Mismatches stop batch application. |
| FR-REC-06 | P0 | A complete forecasted run shall reproduce the predicted result tree before receipts are published. | Implemented | Tree mismatch blocks publication and remains abortable. |
| FR-REC-07 | P0 | A conflict shall pause with a durable worktree-local operation journal. | Implemented | Operation survives CLI process exit. |
| FR-REC-08 | P0 | Continue shall retain source-change context and classify contextual application or explicit fork. | Implemented | Application receipt schema v4 records relation and paths. |
| FR-REC-09 | P0 | Abort shall restore the exact reconciliation starting commit, including after earlier queue entries applied. | Implemented | Mid-queue abort test verifies restoration and no receipts. |
| FR-REC-10 | P1 | Completion shall publish application receipts and one reconciliation receipt only after all invariants pass. | Implemented | Partial records remain in the private journal until finalization. |
| FR-REC-11 | P1 | Output shall distinguish active application time from elapsed time waiting on a human or agent. | Implemented | Receipt timings include active and elapsed values. |
| FR-REC-12 | P2 | Forecasting shall support explicitly captured workspace drafts/checkpoints without pretending mutable bytes are committed state. | Implemented for source checkpoints | `workspace forecast --source-checkpoint` pins checkpoint/base/tree identity and ignores live dirty bytes. |

### 9.6 Conflict resolution memory

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-RES-01 | P0 | Exact textual conflicts shall be keyed by ordered base, target, and source blob identities. | Implemented | Signature algorithm is `ordered-three-way-blobs/v1`. |
| FR-RES-02 | P0 | The exact signature shall be path-independent so a rename does not prevent reuse. | Implemented | Cross-path/worktree reuse test passes. |
| FR-RES-03 | P0 | A prior result shall not be applied automatically without an explicit action or pinned forecast approval. | Implemented | `resolve apply` or `--use-forecast` is required. |
| FR-RES-04 | P0 | Ambiguous result variants shall require an explicit resolution ID. | Implemented | Multiple candidates cannot be silently selected. |
| FR-RES-05 | P1 | A result blob shall be retained against normal garbage collection. | Implemented | Hidden resolution ref points to a commit containing the blob. |
| FR-RES-06 | P1 | Receipts shall distinguish created, accepted, modified, and rejected decisions. | Implemented | Application and resolution records preserve outcome. |
| FR-RES-07 | P2 | Lower-confidence learned or semantic candidates shall occupy a separate tier from exact signatures. | Planned | Confidence/provenance is visible and exact tier remains unchanged. |
| FR-RES-08 | P2 | Resolution data shall synchronize and verify safely across clones. | Implemented experimentally | Metadata round-trip retains records and result blobs with integrity checks. |

### 9.7 AI-oriented workspaces and worktrees

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-WS-01 | P0 | Each active workspace shall have an ordinary linked Git worktree. | Implemented | `vlab workspace create` uses `git worktree add`. |
| FR-WS-02 | P0 | Pending reconciliation and forecasts shall be isolated by worktree. | Implemented | Concurrent-worktree integration tests pass. |
| FR-WS-03 | P0 | Shared receipts and exact resolution records shall be visible from all linked worktrees. | Implemented | Common Git refs/notes back shared facts. |
| FR-WS-04 | P1 | Workspace metadata shall include stable ID, name, base snapshot, path, owner/focus fields, branch, and lifecycle. | Implemented | Workspace registry schema v1 stores these fields and an active/archived materialization state. |
| FR-WS-05 | P1 | A checkpoint shall capture tracked and non-ignored untracked files without changing the real `HEAD`, index, or worktree. | Implemented | Temporary-index checkpoint test verifies invariants. |
| FR-WS-06 | P1 | Two workspace heads shall be forecastable without switching either worktree. | Implemented | `workspace forecast` compares committed heads. |
| FR-WS-07 | P2 | Workspace lifecycle shall support archive, restore, move, prune, and stale-path repair. | Implemented for conservative v1 lifecycle | Commands preserve workspace/branch/checkpoint identity; archive refuses dirty or ignored files and prune requires `--apply`. |
| FR-WS-08 | P2 | A native workspace model shall support private draft stacks without requiring a public compatibility branch. | Deferred | Requires a later storage/protocol layer; Git branch remains v0.x compatibility mechanism. |
| FR-WS-09 | P2 | Workspace creation and status shall scale to many parallel agents without serial scans of unrelated worktrees. | Implemented for batched status | Complete status uses one worktree-scoped Git query per materialized workspace; the repository-scale rerun measures one process per registered workspace with unchanged semantics, and larger multi-host evidence is the next gate. |

### 9.8 Specification and documentation model

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-SPEC-01 | P0 | Exact Markdown bytes, normalized only by documented line-ending rules during semantic rendering, shall remain canonical source. | Implemented | Sidecar can be rebuilt; Markdown is directly readable/editable. |
| FR-SPEC-02 | P0 | Preambles, heading sections, and explicit `REQ-*:` records shall have stable semantic IDs across ordinary edits and moves. | Implemented | Stability and migration tests pass. |
| FR-SPEC-03 | P0 | Ordinary IDs shall be deterministically derived from artifact identity and semantic key. | Implemented | Algorithm is `artifact-semantic-key-sha256/v1`. |
| FR-SPEC-04 | P0 | Legacy non-derived IDs shall survive migration through sparse overrides. | Implemented | v1/v2 to v3 migration preserves all IDs. |
| FR-SPEC-05 | P0 | Sidecars shall avoid duplicating titles, positions, content hashes, and ordinary IDs. | Implemented | Sparse manifest v3 stores identity and exceptions only. |
| FR-SPEC-06 | P1 | Unchanged tracked documents shall be skipped by Git blob identity without content reads. | Implemented | Batch index reports blob hits and zero reads. |
| FR-SPEC-07 | P0 | Independent heading-block edits shall combine deterministically. | Implemented | Forecasted spec merge test produces expected tree. |
| FR-SPEC-08 | P0 | Same-block divergent edits, delete-versus-edit, and incompatible ordering shall remain explicit blockers. | Implemented | Conservative conflict tests pass. |
| FR-SPEC-09 | P0 | A move on one side and content edit on the other shall combine when ordering remains unambiguous. | Implemented | Move-plus-edit test passes. |
| FR-SPEC-10 | P0 | Semantic suggestions shall be pinned by exact input and output hashes and explicitly accepted or modified. | Implemented | Forecast and paused-resolution paths audit the decision. |
| FR-SPEC-11 | P1 | Staged Markdown and sidecar consistency shall be validated before reconciliation continues. | Implemented | Stale sidecar blocks continuation. |
| FR-SPEC-12 | P1 | Corpus benchmarks shall report entity count, raw and estimated compressed metadata, cache hits, reads, and cold/incremental timings. | Implemented | Benchmark schema v2 emits these measures. |
| FR-SPEC-13 | P2 | Additional structured formats shall be added only with a versioned parser, canonical renderer, stable identity model, and conservative merge contract. | Planned | New adapter passes a shared semantic-merge conformance suite. |

### 9.9 Performance and observability

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-PERF-01 | P0 | Optimization shall not change plans, forecast steps, predicted trees, or receipt semantics. | Implemented | Ordinary/session equality demo and tests pass. |
| FR-PERF-02 | P1 | Metrics shall distinguish logical Git queries from operating-system process launches. | Implemented | Forecasts and receipts report both. |
| FR-PERF-03 | P1 | Immutable object reads may share an invocation-scoped Git process. | Implemented | `cat-file --batch-command` session is available. |
| FR-PERF-04 | P0 | Session caches shall use only full object-ID-rooted expressions, never mutable symbolic refs or index expressions. | Implemented | Cache eligibility and fallback tests cover the rule. |
| FR-PERF-05 | P0 | Successful mutations shall invalidate session state, and session failure shall fall back to ordinary Git. | Implemented | Forced-worker-failure integration test passes. |
| FR-PERF-06 | P0 | Linked worktrees shall not share a session whose interpretation could depend on private `HEAD`, index, or operation state. | Implemented | Sessions are keyed by resolved worktree path. |
| FR-PERF-07 | P1 | Trace output shall report command class and timing without file content or commit-message payloads. | Implemented | `--trace-git` output is metadata-only. |
| FR-PERF-08 | P1 | Windows shall use the measured lower-process path by default while other platforms can compare explicitly. | Implemented | Platform default plus force/disable flags exist. |
| FR-PERF-09 | P2 | A cross-command daemon or repository service shall be introduced only after benchmarks show startup/round-trip cost remains material after batching. | Planned gate | Decision requires an ADR with Windows and non-Windows evidence. |
| FR-PERF-10 | P2 | Large-repository benchmarks shall cover history depth, worktree count, note volume, resolution volume, and documentation volume. | Implemented for synthetic fixtures | `vcs-lab.repository-scale-benchmark/v1` covers repository/shared-metadata volume and links `vcs-lab.spec-benchmark/v2` for documentation volume. |

### 9.10 Metadata portability, protocol, and trust

| ID | Pri | Requirement | Status | Acceptance signal |
| --- | --- | --- | --- | --- |
| FR-PROTO-01 | P0 | Every persisted record shall carry a schema identifier and version. | Implemented | Current records use namespaced `vcs-lab.*` schemas. |
| FR-PROTO-02 | P1 | Unknown newer schemas shall fail safely instead of being treated as trusted coverage. | Implemented for portable causal facts | Unknown or unsupported records are diagnosed and quarantined from coverage, resolution lookup, and export. |
| FR-PROTO-03 | P1 | A metadata inventory shall enumerate notes, hidden refs, sidecars, worktree-private state, and required object reachability. | Implemented | `vlab metadata status --json` explains scope, completeness, and damage with stable codes. |
| FR-PROTO-04 | P1 | Export/import shall preserve causal records and retained objects without requiring users to know internal refspecs. | Implemented experimentally | Deterministic Git-bundle envelopes round-trip between clones idempotently. |
| FR-PROTO-05 | P1 | Imported metadata shall be validated for schema, referenced object existence, attachment reachability, and conflicting IDs. | Implemented | Corrupt, tampered, unrelated, dangling, and conflicting fixtures fail or are quarantined before mutation. |
| FR-PROTO-06 | P2 | Remote synchronization shall advertise capabilities and negotiate schema versions. | Deferred | Requires a protocol gateway or cooperating server. |
| FR-TRUST-01 | P0 | Local receipt presence shall never be described as cryptographic proof or authorization. | Implemented principle | User-facing docs distinguish causal evidence from trust. |
| FR-TRUST-02 | P2 | Records may later be signed by actors whose keys and authorization scope are explicit. | Deferred | Signature envelope, key rotation, replay protection, and policy model are specified and tested. |
| FR-TRUST-03 | P2 | A trusted landing service may attest policy and atomically publish Git and causal refs. | Deferred | Service design retains offline/local inspection and Git compatibility. |

## 10. Non-functional requirements

### 10.1 Correctness and safety

| ID | Requirement |
| --- | --- |
| NFR-COR-01 | No receipt may be published for a mutation that did not complete and pass its final invariants. |
| NFR-COR-02 | Fixed inputs, metadata, options, and Git version family shall produce the same classifications and trees. |
| NFR-COR-03 | Exact tree identity shall be compared independently from commit topology. |
| NFR-COR-04 | Interrupted writes to JSON state shall not expose a partially written file; use atomic rename in the same directory. |
| NFR-COR-05 | Temporary worktrees, indexes, and refs shall be cleaned on success and best-effort on failure without deleting user data. |
| NFR-COR-06 | Any automatic decision must be reproducible from persisted identifiers and versioned algorithms. |

### 10.2 Compatibility and portability

| ID | Requirement |
| --- | --- |
| NFR-PORT-01 | Supported baseline is Node.js 20+ and Git 2.40+ (raised from 2.38 on 2026-08-28 by ADR-0015 for `git merge-tree --merge-base`) until changed by a documented release decision. |
| NFR-PORT-02 | Tests shall run on Windows and a POSIX platform; newline-sensitive behavior shall state whether LF normalization is semantic. |
| NFR-PORT-03 | Paths stored for portable identity shall use repository-relative normalized form; local materialization paths may remain platform-specific. |
| NFR-PORT-04 | Repositories using SHA-1 or SHA-256 object formats shall not be rejected by hard-coded OID length assumptions. |
| NFR-PORT-05 | A OneDrive-hosted Windows repository is a first-class performance and correctness environment, not an unsupported edge case. |

### 10.3 Performance and scale

| ID | Requirement |
| --- | --- |
| NFR-PERF-01 | Common plan construction shall use a bounded number of process launches independent of source commit count where Git streaming commands permit it. |
| NFR-PERF-02 | An unchanged repository-wide specification index shall perform zero document content reads for tracked unchanged files. |
| NFR-PERF-03 | Performance reports shall include process count and semantic equality, not wall time alone. |
| NFR-PERF-04 | The prototype shall avoid a resident service until measured use cases justify lifecycle, locking, and security complexity. |
| NFR-PERF-05 | No fixed production scale claim is made until representative large-repository fixtures and targets are ratified. |
| NFR-PERF-06 | Per-invocation latency budgets for agent loops shall be measured per host by the benchmark suite; once a baseline is committed with the automated regression check that consumes it (`docs/README.md`), a regression against it blocks a release. |
| NFR-PERF-07 | Storage efficiency shall be measured as bytes on disk and bytes transferred for repository content and causal metadata, compared against plain Git and any named alternative on the same fixture. |

### 10.4 Durability and recoverability

| ID | Requirement |
| --- | --- |
| NFR-DUR-01 | Completed shared facts shall be backed by reachable Git objects/refs or tracked files. |
| NFR-DUR-02 | Paused operation state shall identify its worktree, starting commit, current queue item, approved decisions, and recovery commands. |
| NFR-DUR-03 | Abort shall never target a branch or path inferred from an unvalidated broad pattern. |
| NFR-DUR-04 | Metadata export shall eventually be self-describing and integrity-checkable before it is the recommended transfer path. |

### 10.5 Security and privacy

| ID | Requirement |
| --- | --- |
| NFR-SEC-01 | Git subprocesses shall use argument arrays, bounded outputs, and validated object expressions rather than shell interpolation. |
| NFR-SEC-02 | Trace and benchmark output shall not emit repository file contents, secrets, or full commit messages. |
| NFR-SEC-03 | Imported metadata shall be untrusted until validated; a receipt shall not grant execution authority. |
| NFR-SEC-04 | A future service must define authentication, authorization, signature verification, denial-of-service bounds, and audit retention before production use. |

### 10.6 Usability and explainability

| ID | Requirement |
| --- | --- |
| NFR-UX-01 | Destructive or broad mutations shall name the exact target and offer a status/abort path when applicable. |
| NFR-UX-02 | Human output shall lead with result, source, coverage, state equality, and required next action. |
| NFR-UX-03 | Proof, heuristic, and blocked statuses shall use distinct labels and never rely on color alone. |
| NFR-UX-04 | Error messages shall preserve actionable Git output while adding protocol-specific recovery context. |
| NFR-UX-05 | Common workflows shall be documented for PowerShell as well as POSIX shells. |

### 10.7 Maintainability and testing

| ID | Requirement |
| --- | --- |
| NFR-TEST-01 | Every invariant-changing feature shall add an integration test using a disposable repository. |
| NFR-TEST-02 | The full suite shall pass with the persistent Git session enabled and disabled. |
| NFR-TEST-03 | Schemas and algorithms shall be versioned; incompatible changes require migration tests and an ADR. |
| NFR-TEST-04 | Demos shall be executable experiments with printed follow-up commands, not unverified documentation snippets. |
| NFR-TEST-05 | Release artifacts shall be tested independently of the source checkout. |

## 11. Critical user journeys

### Journey A: compactly land a feature

1. User creates and develops a normal branch with stable Change IDs.
2. User switches to the target and requests a compact merge.
3. Git performs a conventional two-parent merge.
4. First-parent history shows one landing unit.
5. The landing receipt explains absorbed changes.
6. A future Git merge still understands ancestry without `vlab`.

**Success:** compact history does not destroy causal reachability.

### Journey B: continue after a hard squash

1. A feature is hard-squash landed with an exact receipt.
2. Development continues on the original feature branch.
3. The user asks for a merge plan back to the target.
4. Previously absorbed revisions are marked covered by receipt evidence.
5. Only the continuation is forecast and reconciled.

**Success:** no duplicate replay merely because the physical merge base is old.

### Journey C: preview and resolve a contextual conflict

1. Target and source make competing changes.
2. Forecast simulates the queue in a detached temporary worktree.
3. It either predicts a clean result, proposes one exact known resolution, or
   blocks with explicit conflicts.
4. User reviews and authorizes the pinned forecast or starts reconciliation.
5. A real conflict pauses durably; user resolves, applies an exact suggestion,
   or explicitly forks identity.
6. Continue verifies staged state and publishes receipts only on full success.

**Success:** the operation is inspectable, resumable, and abortable, and the
final record distinguishes adaptation from changed intent.

### Journey D: run parallel agents in worktrees

1. Maintainer creates one workspace/worktree per agent with a pinned base and
   optional focus metadata.
2. Each agent can commit or checkpoint independently.
3. One agent may pause reconciliation without overwriting another agent's
   journal.
4. Completed receipts and exact resolutions become visible across worktrees.
5. Maintainer may forecast committed workspace heads or an explicitly captured
   immutable source checkpoint without switching either worktree.
6. A workspace can move, archive/restore, or repair a stale machine-local path
   without changing its logical ID, branch, or retained checkpoint identity.

**Success:** private mutable state is isolated while reusable facts are shared.

### Journey E: merge a high-volume specification corpus

1. Markdown documents are indexed into sparse identity manifests.
2. Unchanged tracked documents are skipped by blob identity.
3. Two agents edit different heading sections of the same document.
4. Forecast detects the manifest/text conflict and computes a deterministic
   stable-block merge.
5. The user reviews and applies the pinned result.
6. Same-block ambiguity would instead remain blocked.

**Success:** independent changes combine without losing human-readable source,
stable IDs, or auditability.

## 12. Current release scorecard

| Capability | v0.9 status | Evidence |
| --- | --- | --- |
| Stable change identity | Complete for local prototype | Commit/cherry-pick/fork integration tests |
| Compact and hard-squash landing | Complete for local prototype | Parent-shape and receipt tests |
| Causal planning | Complete for current proof types | Hard-squash and candidate tests |
| Causal rebase | Supervised linear-v1 flow implemented | Exact omission/replay, heuristic decisions, forecast tree, stale rejection, stable/forked identity, conflict recovery, abort, worktree isolation, and portable receipt tests |
| Resumable reconciliation | Complete for current queue model | Continue, abort, fork, multi-worktree tests |
| Exact resolution reuse | Complete locally | Cross-path/worktree and provenance tests |
| Forecast and pinned batch application | Complete locally | Non-mutation, stale, mismatch, batch tests |
| Workspaces/checkpoints | Experimental but usable | Create/list/checkpoint/lifecycle and committed/checkpoint forecast tests |
| Stable Markdown entities | Complete for parser v1 | Edit/move and migration tests |
| Deterministic Markdown merge | Complete for section-level rules | Clean and blocked merge tests |
| Sparse metadata and incremental indexing | Complete for manifest v3 | Corpus, migration, zero-read tests |
| Invocation-scoped Git object session | Complete with lazy startup and fallback | Equality/count/failure/worktree tests plus 10 direct, 20 redirected, three full current-Node, and one full Node 20 forced-session qualification runs |
| Repository-scale evidence | Synthetic representative profile implemented; selected batching implemented | Trendable semantic/process/timing measurements selected workspace-status and resolution-catalog batching; the rerun shows one process per workspace and six for the resolution catalog; no index or service is yet justified |
| Metadata integrity and portability | Experimental but complete for accepted shared facts | Inventory/validation plus deterministic envelope and two-clone idempotence tests |
| Cryptographic trust/server policy | Not implemented | Explicit non-goal |
| Native store/protocol | Not implemented | Exit criteria not yet satisfied |

## 13. Success metrics

### 13.1 Semantic correctness metrics

- Duplicate applications prevented after hard squash.
- Percentage of forecasted complete runs that reproduce their predicted tree.
- Number of heuristic candidates silently accepted: target **zero**.
- Number of receipts published for aborted/incomplete operations: target
  **zero**.
- Stable entity ID retention across supported edits and manifest migrations:
  target **100%** for covered fixtures.
- Cross-worktree pending-state collisions: target **zero**.

### 13.2 Workflow metrics

- Changes applied per reconciliation versus changes proven already covered.
- Conflicts resolved by an exact reviewed prior result.
- Repeated manual resolution effort avoided.
- Forecasts reviewed before mutating reconciliations.
- Workspace checkpoints and recoveries completed without disturbing the active
  index.

### 13.3 Performance and storage metrics

- Logical Git queries and actual process launches per plan/forecast/reconcile.
- Windows median and p95 for head, status, history, notes, and object-session
  probes.
- Forecast phase timings and time spent inside Git.
- Content reads and blob-cache hits for specification indexing.
- Sparse manifest bytes per entity and ratio to source bytes.
- Result equality between optimized and ordinary compatibility paths.
- Per-entity process amplification for workspace, note, and resolution scans.
- Elapsed time per operation per host against plain Git's best mode
  (`merge-tree`, sparse cones, parallel status) and any named alternative on
  the same workload, with identical semantic results.
- Bytes on disk and bytes transferred for repository content and causal
  metadata against plain Git and any named alternative (storage compression).
- Agent-fleet metrics from dogfooding: Git processes per agent-minute,
  workspace creation cost and materialized bytes, checkpoint cost, and
  forecast reproduction rate on real sessions.

The v0.7 release demonstration reduced a 12-change forecast from 52 to 25 Git
process launches (51.9%) while preserving the complete forecast. The v0.6
default corpus represented 2,025 semantic entities with 11,240 bytes of sparse
manifest data instead of 655,545 equivalent expanded bytes (98.29% less).
These are regression baselines, not universal performance guarantees.

The Windows forced-session correction preserved the 12-change forecast while
reducing process launches from 64 to 25. Regression coverage now asserts lazy
worker startup, orderly shutdown, and no-worker preflight behavior. Historical
execution details remain available in Git history; current qualification
commands are defined in [testing.md](testing.md).

The clean-commit `vcs-lab.repository-scale-benchmark/v1` representative Windows
profile measured the plain registry read at 0.31 ms with no Git processes and
the batched 300-target note catalog at 172.67 ms with two processes. In
contrast, status for 12 workspaces used 36 processes and a 1,597.78 ms median,
while 50 retained resolutions used 103 processes and a 5,503.66 ms median.
This is host-specific synthetic evidence: it selected batching for those two
paths and does not establish a production scale target. After batching, the
same schema on a Linux development host measured 12 processes and 35.53 ms for
workspace status and six processes and 30.67 ms for the resolution catalog,
with identical semantic results. See
[ADR-0013](adr/0013-measure-scan-amplification-before-adding-indexes-or-a-service.md).

## 14. Release and quality gates

A release is eligible when:

1. `npm test` passes in ordinary mode.
2. `VLAB_GIT_SESSION=1 npm test` passes.
3. All maintained demos complete.
4. Version constants, package metadata, changelog, and release tag agree.
5. Bundle and source archive install/test smoke checks pass outside the source
   checkout.
6. New schemas or algorithms include migration/compatibility tests.
7. New automated decisions identify their proof/confidence and approval model.
8. Documentation links resolve and the session handoff reflects the release.

Production-readiness requires additional threat modeling, fuzzing, crash/fault
injection, remote interoperability, performance targets, and a support policy.
Passing laboratory gates is not a production claim.

## 15. Roadmap and investment gates

Roadmap themes are directional; a version number is not a promise until its
scope is accepted in an issue, plan, or ADR.

The maintained [roadmap](roadmap.md) turns these product themes and gates into
a prioritized execution sequence and traces every incomplete requirement to a
future horizon. This section remains authoritative for product investment
criteria.

### Completed experimental sequence

- **v0.1:** logical IDs, landing receipts, causal planner, workspaces, Markdown
  identity.
- **v0.2:** durable worktree-local conflict operations and safe abort.
- **v0.3:** exact cross-worktree resolution memory and provenance.
- **v0.4:** non-mutating forecasts and pinned application.
- **v0.5:** deterministic specification reconciliation and instrumentation.
- **v0.6:** sparse spec manifests, zero-read indexing, and batched Git reads.
- **v0.7:** invocation-scoped persistent object plumbing and structural query
  reduction.
- **v0.8:** metadata inventory/validation, quarantine-safe coverage, and
  deterministic Git-bundle export/import between clones.
- **v0.9:** accepted causal rebase model with deterministic planning, isolated
  pinned forecasting, supervised current-branch replay, worktree-private
  recovery, portable completed receipts for linear history, conservative
  workspace lifecycle, immutable source-checkpoint forecasts, an
  evidence-gated repository/shared-metadata scale benchmark, and batched
  workspace-status and resolution-catalog scans.

### Completed theme: metadata integrity and portability

The v0.8 experiment made the current causal layer self-describing and safely
movable without adding a service:

- inventory all shared and private metadata;
- validate schemas, attachments, referenced objects, and retained blobs;
- define an export/import envelope with repository identity and capability data;
- provide idempotent two-clone round-trip tests;
- quarantine unknown or invalid claims rather than using them for coverage;
- document trust separately from integrity.

The first transport is deliberately an offline Git bundle plus a small hashed
manifest. It is not a signing or authorization layer.

### Subsequent candidate themes

- Target-checkpoint forecasts and native private draft stacks beyond the
  conservative worktree-backed implementation.
- Broader causal rebase forms beyond linear v1: merge preservation, interactive
  editing, arbitrary ranges, and checkpoint/draft overlays.
- Rerun the accepted repository-scale schema on Windows, larger fixtures, and
  real repositories now that workspace-status and resolution-catalog scans are
  batched; consider incremental catalogs only if already-batched scans remain
  over a representative budget.
- A repository-local service only if cross-command process and scan costs remain
  material after batching.
- Protocol capability negotiation and optional remote gateway.
- Signed receipt envelopes and trusted landing policy.
- Additional deterministic structured-document adapters.
- Git-native wins before native code: `git merge-tree` forecast simulation,
  sparse cones from workspace focus, and commit-graph, multi-pack-index, and
  fsmonitor enablement.
- A phased native core in Rust behind the existing contracts (ADR-0015),
  entering under Gate A of the native implementation gate.
- Native content-addressed metadata/store experiments after Gate B is
  satisfied.

### Native implementation gate

[ADR-0014](adr/0014-split-the-native-implementation-gate-into-engine-and-store-gates.md)
splits the gate into two.

**Gate A: semantics-preserving native engine.** An engine that implements
existing contracts a second time may begin when all of:

1. a published schema and conformance-fixture catalog and a single
   equality-tested read-side engine seam exist;
2. the Windows post-batching benchmark rerun and a Git-best-mode baseline
   exist; and
3. a named per-command budget on a representative Windows or OneDrive host
   that the batched Git path misses is recorded in the engine's ADR.

Gate A work passes the complete suite in every engine mode with identical
domain JSON, is reversible, never moves a receipt-publishing path between
engines before an equality test exists for it, adds only derived deletable
caches and no canonical record store or persisted-contract change, and is
removed from the package if it has not met its named budget within two minor
releases after the engine first ships (ADR-0014).

**Gate B: semantics-changing native store, protocol, or draft stacks.** Begins
only when trials demonstrate all of:

1. users prefer compact landing and use receipts to recover squash causality;
2. stable logical IDs materially improve rewrite and cherry-pick workflows;
3. forecasts reproduce predicted trees reliably;
4. worktree workspace/checkpoint behavior improves parallel-agent operation;
5. exact resolution reuse avoids repeated work without unsafe automation;
6. stable specification entities and deterministic merge help real corpora;
7. metadata portability requirements cannot be met cleanly with Git refs/notes;
8. measured storage, process, or filesystem overhead is material enough to
   justify a new subsystem; and
9. real agent-workload evidence from at least two hosts (one Windows or
   OneDrive, one POSIX) and one real repository shows the §13.3 metrics for
   actual agent sessions.

**Evidence plan.** The user-value and workload conditions are satisfied by
dogfooding: the maintainer's coding agents use `vlab` on this repository and
other real repositories, with telemetry retained as CI artifacts or issue
attachments and summarized in ADRs when it supports a decision.

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Locally forged receipts are mistaken for trusted proof | Incorrect coverage or policy claims | Treat them as local causal evidence; add validation, signing, and authorization as separate layers. |
| Notes or hidden refs are not fetched | Missing coverage/resolutions across clones | Use validated envelope export/import and completeness diagnostics; keep useful trailers in landing commits. |
| Stable Change IDs are copied to semantically different work | False coverage | Provide explicit fork workflows, collision audits, and never use ID alone as authorization. |
| Heuristic equivalence suppresses real work | Data loss | Keep candidates advisory and require explicit acceptance. |
| A forecast becomes stale | Applying a reviewed decision to new inputs | Pin heads, trees, plan fingerprint, signatures, result IDs, and final tree; fail before mutation. |
| Semantic parser changes move identity boundaries | Review/merge discontinuity | Version parser and ID algorithms; require migrations and ADRs. |
| Sidecar conflicts dominate document conflicts | Poor usability | Keep sidecars sparse, derive ordinary fields, batch reads, and semantically merge them with canonical Markdown. |
| Persistent Git worker deadlocks or serves stale data | Hang or wrong result | Bound buffers/timeouts, cache only immutable expressions, invalidate on mutation, isolate by worktree, and fall back. |
| Many agents overload worktree and metadata scans | Latency and coordination failures | Use the repository-scale schema to remove measured per-entity process amplification first; require post-batching evidence before adding indexes or claiming high scale. |
| Native rewrite begins too early | Complexity and adoption failure | Enforce measured exit criteria and preserve Git as oracle during experimentation; enter native code only behind an equality-tested seam with a sunset (ADR-0014). |
| A native engine adds a second implementation of every read contract | Divergence and maintenance load for one maintainer | Automated equality in every engine mode, per-operation fallback, `engine`/`fallbacks` in every result, and removal at the ADR-0014 sunset. |
| Rust toolchain, packaging, and library churn | Velocity loss, unsupported platforms, silent fallback | Funded explicitly (ADR-0015): seam-first order, pinned backends behind a trait, prebuilt bindings with a guaranteed JavaScript fallback, fuzzed parsers. |
| Documentation drifts from executable behavior | Incorrect future implementation | Link requirements to schemas/tests, keep a release handoff, and update docs in every invariant-changing release. |

## 17. Open product questions

These questions are intentionally unresolved:

1. Should a future lineage version support deliberate history-filtered imports,
   and what proof can replace the shared-root rule without enabling unrelated
   metadata injection?
2. Which causal claims are safe to merge automatically when two metadata
   sources disagree?
3. Should logical Change IDs be repository-scoped, globally namespaced, or
   issuer-qualified?
4. What is the minimum trust model for a shared team: signed developer records,
   a landing-service attestation, or both?
5. Does the accepted target-context application model for causal rebase remain
   intuitive once forecast, conflict recovery, and application are exercised?
6. Should the accepted immutable source-checkpoint model expand to a captured
   target overlay, and what approval/application semantics should that require?
7. At what measured thresholds does a long-lived repository service outperform
   invocation-scoped Git plumbing enough to justify lifecycle and security
   costs?
8. Should portable spec identity remain a tracked sidecar, move into Git object
   metadata, or become a native structured object after the experiment?
9. Which document formats have stable enough semantic boundaries for safe
   deterministic adapters?
10. How much causal history can be compacted without weakening audit or
    invalidating old plans?

## 18. Definition of product success

The laboratory succeeds if it establishes, with repeatable local evidence,
that a Git-compatible causal and semantic layer can:

- retain the adoption surface developers already know;
- prevent redundant replay after squash and rewrite;
- make branching, cherry-picking, worktrees, and conflict recovery easier to
  reason about;
- safely automate exact decisions while exposing ambiguity;
- scale specification identity without duplicating the corpus;
- provide a credible, measured contract for a native protocol that is more
  efficient than Git and any named alternative on the same workload and host:
  lower elapsed time per operation and fewer bytes stored and transferred
  (speed and storage compression), with identical semantic results.

It fails if the added metadata is routinely missing, untrusted, larger or more
fragile than the problem it solves; if users cannot recover with normal Git;
if a native path is slower or larger than plain Git's best mode on the
workload and host where it claims efficiency; or if automation hides uncertain
decisions behind a simpler-looking command.
