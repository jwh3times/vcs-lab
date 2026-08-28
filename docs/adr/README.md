# Architecture decision records

Architecture decision records (ADRs) capture decisions whose constraints should
survive refactoring and session boundaries. They complement the
[product requirements](../product.md) and the implemented
[architecture](../architecture.md).

## Status vocabulary

- **Proposed:** under consideration; implementation must not rely on it as an
  accepted constraint.
- **Accepted:** normative until superseded.
- **Deprecated:** still present but should not be used for new work.
- **Superseded:** replaced by a named later ADR; retained for history.
- **Rejected:** considered and deliberately not selected.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-use-git-as-the-compatibility-and-storage-substrate.md) | Accepted | Use Git as the compatibility and storage substrate during the laboratory phase |
| [0002](0002-separate-state-change-application-and-landing-identity.md) | Accepted | Separate state, logical change, application, and landing identity |
| [0003](0003-prefer-causal-compact-landings-and-receipt-backed-hard-squash.md) | Accepted | Prefer causal compact landings and require receipts for hard squash |
| [0004](0004-use-an-explicit-coverage-proof-lattice.md) | Accepted | Use an explicit coverage proof lattice and never silently accept heuristics |
| [0005](0005-scope-private-operation-state-to-a-worktree.md) | Accepted | Scope private operation state to a worktree and completed facts to the repository |
| [0006](0006-forecast-and-pin-automated-reconciliation-decisions.md) | Accepted | Forecast and pin automated reconciliation decisions before application |
| [0007](0007-keep-resolution-automation-exact-or-deterministic.md) | Accepted | Keep resolution automation exact or deterministic and expose ambiguity |
| [0008](0008-keep-markdown-canonical-and-spec-metadata-sparse.md) | Accepted | Keep Markdown canonical and specification metadata sparse and derived |
| [0009](0009-use-an-invocation-scoped-git-object-session.md) | Accepted | Use an invocation-scoped, worktree-isolated Git object session |
| [0010](0010-add-a-validated-metadata-envelope-before-a-server.md) | Accepted | Add a validated metadata envelope before a native server or store |
| [0011](0011-model-causal-rebase-as-a-forecasted-application-sequence.md) | Accepted | Model causal rebase as a forecasted application sequence |
| [0012](0012-treat-workspace-lifecycle-as-reversible-materialization-and-drafts-as-checkpoint-inputs.md) | Accepted | Treat workspace lifecycle as reversible materialization and drafts as checkpoint inputs |
| [0013](0013-measure-scan-amplification-before-adding-indexes-or-a-service.md) | Accepted | Measure scan amplification before adding indexes or a service |
| [0014](0014-split-the-native-implementation-gate-into-engine-and-store-gates.md) | Accepted | Split the native implementation gate into engine and store gates |
| [0015](0015-adopt-a-phased-native-core-program-with-rust.md) | Accepted | Adopt a phased native-core program with Rust as the core language |

## Creating or changing an ADR

1. Copy the structure used by an existing ADR.
2. Assign the next four-digit number; never reuse a number.
3. State the context, decision, constraints, consequences, and rejected
   alternatives. Avoid restating an entire implementation plan.
4. Link requirements and code areas affected.
5. If changing an accepted decision, add a new ADR and mark the old one
   `Superseded by ADR-NNNN`; do not rewrite its historical rationale.
6. Add or update tests for any observable invariant.
7. Update this index, `../architecture.md`, and affected product or testing
   documentation when the current system changes. Track active implementation
   instructions in an issue rather than a session handoff document.

An ADR can be accepted in the same commit as its initial implementation when the
decision is already established by tested repository behavior. Speculative
future designs should remain Proposed.
