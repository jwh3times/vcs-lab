# ADR-0010: Add a validated metadata envelope before a server

- **Status:** Proposed
- **Date:** 2026-08-20
- **Owners:** Repository maintainers
- **Related requirements:** FR-GIT-08, FR-PROTO-01 through FR-PROTO-06, FR-TRUST-01 through FR-TRUST-03

## Context

The local prototype stores causal records in Git notes, exact result objects
under hidden refs, workspace metadata in a common-directory JSON file, private
operations in worktree directories, and spec identity in tracked sidecars.
Normal Git branch fetches do not transfer every shared namespace. Users must
currently know two refspecs to move notes and resolution objects, and there is
no single integrity inventory or schema compatibility report.

Building a server now would mix transport, validation, trust, policy, and
storage decisions before the portable unit is defined.

## Proposed decision

Before a native store, long-lived service, or hosted protocol, define and
implement a versioned metadata envelope/inventory that can:

- identify repository/object-format context and supported capabilities;
- enumerate causal note records and their attachment OIDs;
- enumerate resolution refs and verify retained result blobs;
- describe tracked spec manifest schemas without duplicating their content;
- distinguish shared portable facts from machine-local/worktree-private state;
- validate schema versions, required fields, referenced object existence,
  reachability assumptions, and ID conflicts;
- export/import shared facts idempotently between two Git clones;
- quarantine unknown or invalid records so they cannot prove coverage;
- report integrity separately from cryptographic trust and authorization.

Use Git objects/refs as the first transport implementation. Do not make a
daemon or remote service a prerequisite.

## Expected consequences

### Positive

- Multi-clone experiments become reproducible without internal ref knowledge.
- The product gains a clear boundary for later signing and capability
  negotiation.
- Corrupt or partial metadata can be diagnosed before planning consumes it.
- The need for a native server can be measured against a working portable form.

### Negative

- Schema validation and conflict policy add substantial design work.
- Repository identity across clones/forks is not yet settled.
- An envelope may duplicate some Git transport concepts.
- Signing must remain separate; integrity validation alone does not establish
  actor trust.

## Alternatives under consideration

- A Git bundle containing dedicated metadata refs.
- A deterministic manifest plus ordinary Git fetch/push refspecs.
- A single namespaced metadata ref with an append-only tree.
- A protocol gateway that advertises metadata capabilities.

## Acceptance conditions for this ADR

Promote to Accepted only after the repository defines:

1. portable versus local scope;
2. repository/fork identity behavior;
3. schema compatibility and quarantine rules;
4. idempotent import conflict semantics;
5. exact commands and two-clone integration fixtures;
6. explicit non-claims about signing and authorization.
