# Logical identity protocol

`vcs-lab.logical-id/v1` is the frozen specification of the identifiers vcs-lab
mints: their namespace, their entropy, and what happens when two repositories
disagree about one (FR-ID-07). It exists because logical identity is about to
be read by things other than the tool that wrote it — the portable proof
bundle of FR-PLAN-08 hands a coverage classification to a third party — and
because the roadmap requires this specification **before identifiers
participate in any trust decision**.

**Authority.** `ID_NAMESPACES`, `ID_ENTROPY_BITS`, and `parseLogicalId` in
`src/ids.js` are the runtime authority; this document describes them.

## 1. Form

```
<namespace>_<minted><random>
```

| Part | Width | Alphabet | Meaning |
| --- | --- | --- | --- |
| `namespace` | variable | `[a-z_]` | What kind of thing the identifier names |
| `minted` | 9 | base36 | `Date.now()` in base36, zero-padded |
| `random` | 12 | hex | 48 bits from the system CSPRNG |

A namespace may itself contain underscores (`rebase_apply`), so the split is
by the fixed 21-character suffix rather than by the first underscore.

## 2. Namespaces

The set is closed. An identifier in an unlisted namespace is not a vcs-lab
logical identifier, which is what lets a reader tell one from an arbitrary
string that happens to contain an underscore.

| Namespace | Names |
| --- | --- |
| `ch` | a logical change, carried by the `Change-Id` commit trailer |
| `land` | a landing receipt |
| `apply` | an application receipt |
| `reconcile` | a reconciliation receipt |
| `reconcile_op` | a worktree-private reconciliation journal |
| `rebase` | a completed causal rebase receipt |
| `rebase_apply` | a rebase application receipt |
| `rebase_op` | a worktree-private rebase journal |
| `forecast` | a stored reconciliation forecast |
| `rebase_forecast` | a stored rebase forecast |
| `resolution` | a recorded conflict resolution |
| `ws` | a workspace registry entry |
| `artifact` | a specification artifact |

### Identifiers that are not minted

Three other identity forms exist and are deliberately **not** logical
identifiers, because they are derived rather than drawn:

- **`git:<oid>`** — the fallback identity of a commit with no `Change-Id`
  trailer (FR-ID-05). It is a commit address standing in for an absent logical
  identity. `parseLogicalId` reports it as `commit-fallback-identity` rather
  than malformed, so the two forms stay distinguishable.
- **`rsig_<sha256>`** — a resolution signature, derived from the three merge
  stages under `ordered-three-way-blobs/v1`. Two identical conflicts produce
  the same signature *on purpose*; that is what makes resolutions reusable.
- **`lineage_<sha256>`** — repository lineage identity, derived from the root
  commits under the canonical JSON profile.

Content-derived identifiers collide exactly when their content matches, which
is the intent. The rest of this document is about minted ones.

## 3. Entropy

Each identifier carries **48 random bits** plus a millisecond clock reading.

The clock is a partition, not a guarantee. Two identifiers can collide only
when they are minted in the same millisecond *and* their random halves match,
so the birthday bound is roughly `2^24` — about 16.7 million identifiers
minted within a single millisecond for an even chance of one collision. No
plausible workload approaches that, locally or across cooperating clones.

**The clock is not a sort key and must never be read as a timestamp for a
decision.** A peer's clock is not ours, it can move backwards, and nothing
verifies it. It exists to partition the random space, and that is all.

### What 48 bits does not buy

Accidental collision is negligible. **Deliberate collision is trivial**, and
no amount of entropy would change that: a `Change-Id` is a line of text in a
commit message, so anyone who can write a commit can claim any logical
identity they like. The same is true of a receipt: records are locally
writable by any actor with repository access.

Logical identifiers therefore **coordinate work; they do not authenticate
it**. This is the same boundary `docs/architecture.md` §15.3 draws for
receipts, and it is why the roadmap gates trust decisions on this
specification rather than on the identifiers themselves.

What defends against a deliberate collision is detection, not entropy:
`vlab audit identity` (FR-ID-06) reports commits that share a `Change-Id`
without any identity-preserving application record linking them, which is
precisely the shape a forged or copied trailer takes.

## 4. Cross-repository import

Identifiers are **globally scoped, not repository-scoped**: the point of a
logical identity is that it survives moving between clones, so `ch_abc` in one
repository names the same logical change as `ch_abc` in another. Nothing
rewrites an identifier on import.

That makes the disagreement case the interesting one. When
`vlab metadata import` merges records from an envelope, each incoming record
is matched against the destination **by identifier**, and the outcome is
decided by comparing digests:

| Condition | Action |
| --- | --- |
| No record with that identifier locally | `add` |
| Same identifier, same digest | `noop` — the import is idempotent |
| Same identifier, **different digest** | `conflict` |

A conflict makes the whole import inapplicable: `vlab metadata import
--dry-run` reports it, `summary.applicable` is false, and the command exits
non-zero without moving a ref. Note merging refuses the same way rather than
picking a winner.

**Refusing is the specification, not a limitation.** Two records sharing an
identifier while differing in content is exactly the situation no automatic
rule can resolve safely: either an identifier was reused for different work,
or one of the records was altered. Merging them would silently destroy one
claim, and choosing by recency would let a later writer overwrite an earlier
one. The import stops and says which identifier disagrees.

`vcs-lab.logical-id/v1` is a profile identifier, not a record family, so it
carries no document in the [schema catalog](../schemas/README.md) — the same
arrangement as the canonical JSON profile.

## 5. Versioning this specification

`vcs-lab.logical-id/v1` covers the form, the namespace set, the entropy, and
the import rule above. Under the
[compatibility contract](../schemas/compatibility.md):

- **adding a namespace** is additive and stays within `v1`, because readers
  treat the namespace as opaque and `parseLogicalId` rejects only unknown
  ones;
- **changing the form, the entropy, or the import rule** is a new version,
  because every existing identifier and every stored record would have to be
  re-read under it.

Raising the entropy would be a version bump and would not change the trust
boundary of §3, so it should only be done for a measured reason.
