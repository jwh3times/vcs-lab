# Documentation

The repository keeps current product, architecture, testing, and decision
records here. The root README is the user-facing entry point; the changelog is
the versioned record of delivered behavior.

## Current references

- [Product requirements](product.md) — product intent, requirements, priorities,
  success metrics, quality gates, and roadmap.
- [Architecture](architecture.md) — implemented components, persisted state,
  runtime flows, invariants, failure handling, and known debt.
- [Testing](testing.md) — supported validation commands and release evidence
  policy.
- [Architecture decision records](adr/README.md) — decisions whose constraints
  should survive refactoring.

## Documentation lifecycle

Commit documentation when it describes a current contract, a durable decision,
or maintained user behavior. Keep it independent of a particular workstation,
temporary directory, session, commit under test, or fixed test count.

Use the project issue tracker for active work, bugs, implementation briefs, and
session handoffs. Use pull requests for implementation rationale and test
summaries. Use CI job summaries and retained CI artifacts for individual test
runs, logs, hashes, and host-specific evidence. Use GitHub Releases and the
changelog for release history.

Do not add an archive directory for superseded session or test documents. Git
history already preserves deleted versions. Add a dated incident document only
when an event has durable operational lessons not captured by an ADR,
regression test, or changelog entry.

Performance results belong in an ADR when they support a decision. Commit a
machine-readable benchmark baseline only when an automated regression check
consumes it; otherwise retain the result with the relevant issue, pull request,
or CI run.
