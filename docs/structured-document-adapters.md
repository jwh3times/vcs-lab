# Structured-document adapter contract

Before a document format is accepted, its adapter must specify the seven parts
below and demonstrate them with executable fixtures. This is the acceptance
contract for FR-SPEC-13, grounded in
[ADR-0008](adr/0008-keep-markdown-canonical-and-spec-metadata-sparse.md) and the
[extension rules](architecture.md#20-extension-rules). It does not define a
plugin API or change the current Markdown algorithms.

Canonical documents must remain usable without vcs-lab. Derived metadata must
not become the only way to recover their content. A deterministic merge may
select only outcomes its published rules justify; ambiguity must be visible
and block automatic application.

## Required adapter specification

| Part | What the adapter must define and demonstrate |
| --- | --- |
| Canonical bytes | Authoritative file or files, encoding, supported syntax, newline and whitespace treatment, hashing inputs, and exact rendering rules. State every permitted normalization and demonstrate round trips, including empty documents and deletion. |
| Entities | Indexed entities and actual merge units, including nesting, preambles, duplicate keys, comments, examples, and unsupported constructs. Every source span must have an unambiguous treatment; indexing an entity does not imply that it merges independently. |
| Identity | Artifact identity, entity-key construction and collision handling, ID algorithm and scope, and what survives content edits, moves, renames, copies, and duplicate insertion. State how exceptional identities are preserved and when correspondence is refused. |
| Deterministic rules | A three-way decision table for unchanged content, one-sided and identical edits, additions, deletions, moves, and ordering. Specify tie-breaking and exact output bytes. The same version and ordered inputs must yield the same result and explanation. |
| Blockers | Explicit refusal conditions for divergent edits, identity ambiguity, conflicting order, unavailable or stale metadata, unsupported versions, and resource bounds. Distinguish a blocked semantic plan from invalid input; neither may silently approve a guessed result. |
| Migrations | Version identifiers for parsing, identity, rendering, merging, and persisted records; readable/writable versions; old-reader and new-reader behavior; preservation or invalidation of indexes, forecasts, and stored resolutions. Changed boundaries must not acquire the meaning of an old algorithm version. |
| Sparse storage | Persisted fields and scope, derived fields, rebuild procedure, unchanged-input cache validation, and measured sidecar size/churn on a representative corpus. Explain exceptional growth and show that ordinary edits do not rewrite a full per-entity catalog. |

The version policy must apply the existing
[per-family compatibility rules](schemas/compatibility.md), including explicit
resource limits. A new contract or changed durable decision requires an ADR;
adding an adapter does not waive that requirement.

## Worked example: current Markdown adapter

The implementation is [src/specs.js](../src/specs.js), with ID slugging in
[src/ids.js](../src/ids.js). These descriptions record the current behavior,
including its limitations; they do not assert full Markdown syntax support.

### Canonical bytes

Markdown source is authoritative and is read as UTF-8 text. `normalizeMarkdown`
converts CRLF and bare CR to LF. The source hash is SHA-256 of that normalized
text; Git blob identity is a separate cache input. Indexing writes the manifest
without rewriting the Markdown source.

Semantic merge rendering additionally trims trailing whitespace from each
selected primary block, joins blocks with two LF characters, trims the joined
tail, and appends one LF. Interior bytes of a selected block are preserved
after newline normalization. This is not a byte-preserving round trip at block
boundaries. An empty surviving document renders as one LF; a deleted document
has no Markdown or manifest result, and application removes both paths.

### Entities

`stable-markdown-blocks/v1` indexes:

- a preamble before the first heading when nonempty, or a preamble for a
  document with no headings;
- sections starting with one to six `#` characters at column zero, followed
  by whitespace and a nonempty title, ending before the next recognized heading
  of any level;
- individual lines matching `REQ-<letters, digits, dot, underscore, hyphen>:`
  followed by nonempty text, with optional leading whitespace.

Only preamble and section entities are primary merge units. Requirement lines
are indexed for identity and queries; two different requirements inside one
section cannot currently merge independently. A child heading begins another
section rather than forming a recursively merged tree.

The v1 parser has no fenced-code state. Heading-like comments and `REQ-...:`
lines inside examples can therefore create false entities. This known defect
is tracked in [#51](https://github.com/jwh3times/vcs-lab/issues/51); its corrected
boundaries and migration need a separate version decision. Adapters must state
this kind of syntax limitation explicitly, and new formats must demonstrate
their treatment of literal/example content.

### Identity

Each document has an `artifact_*` ID retained by reindexing. Its ordinary entity
ID is `ent_` followed by the first 24 hex characters of SHA-256 over the artifact
ID, a NUL separator, and the semantic key. The keys are:

| Entity | Semantic key |
| --- | --- |
| Preamble | `preamble:1` |
| Section | `section:<heading-level>:<title-slug>:<occurrence>` |
| Requirement | `requirement:<uppercased-REQ-name>:<occurrence>` |

Occurrence counts start at one for each repeated base key in source order.
Title slugging applies NFKD, lowercases, maps runs outside ASCII letters and
digits to hyphens, trims edge hyphens, and takes at most 80 characters, falling
back to `untitled`. Optional closing heading hashes are removed before slugging.

Body edits and moves preserve IDs when their semantic keys stay the same.
Heading renames or level changes that change the key do not automatically
preserve identity. Inserting or reordering duplicate keys can change which
occurrence an ID denotes. `idOverrides` preserves exceptional mappings,
including legacy IDs; it is not an automatic rename or copy detector.
Conflicting artifact identities block a merge, and duplicate primary block IDs
make semantic metadata unavailable.

### Deterministic rules

Content decisions compare primary-block hashes, keyed by entity ID:

| Base / target / source relation | Decision |
| --- | --- |
| Both sides unchanged | Keep the target block |
| Exactly one side edits | Keep the edited block |
| Both sides make the same edit | Keep one copy |
| Both delete, or one deletes while the other is unchanged | Delete |
| Only one side adds an ID absent from base | Add that block |
| Both add the same ID and content | Add one copy |
| Both edit differently, delete versus edit, or add the same ID differently | Block |

Ordering compares the surviving base-ID sequences. Equal sequences are accepted;
if only one side moves them, that order wins. Different moves on both sides
block. Added blocks are anchored after a surviving base block or at the start.
The same added ID at different anchors, or contradictory ordering of shared
additions, blocks. Otherwise additions at an anchor are appended target-first,
then source, deduplicated by ID. Swapping target and source can therefore change
addition order; determinism applies to ordered inputs.

### Blockers

The current plan reports `same-block-edit`, `delete-vs-edit`,
`same-block-concurrent-add`, `conflicting-block-order`,
`concurrent-add-placement`, or `conflicting-added-block-order` for merge
ambiguities. Different artifacts report `artifact-identity-mismatch`.
Missing, malformed, stale, unsupported, or oversized committed manifests can
produce `semantic-metadata-unavailable`; a blocked plan has no renderable result.

The tracked manifest bound is `RESOURCE_BOUNDS.specManifestBytes` (8 MiB),
defined by [src/schemas.js](../src/schemas.js). Staged manual resolutions must
add or delete source and manifest together and provide a matching source hash.
Automatic semantic choices are pinned by forecasts and checked on application.

### Migrations and reuse

| Component | Current identifier or policy |
| --- | --- |
| Parser | `stable-markdown-blocks/v1` |
| Entity IDs | `artifact-semantic-key-sha256/v1` |
| Merge and its rendering rules | `stable-markdown-three-way/v1` |
| Persisted manifest | Read v1, v2, v3; write `vcs-lab.spec-manifest/v3` |

Legacy expanded manifests are materialized against source and rewritten as
sparse v3 on indexing, retaining exceptional IDs as overrides. A v3 manifest
with unsupported parser or ID algorithm is refused. No corrected fence parser
or requirement-level merge migration is implemented.

Semantic plan signatures include the merge algorithm, artifact ID, and ordered
base/target/source fingerprints (existence, source hash, manifest hash). Reuse
requires the same pinned inputs and decisions. The exact-resolution catalog is
a separate mechanism based on ordered Git conflict stages; it does not make
semantic entities interchangeable across parser versions. An adapter version
change must explicitly preserve, migrate, or refuse reuse of affected artifacts,
and must not silently relabel old indexes, forecasts, or resolutions.

### Sparse storage

The [v3 manifest](schemas/spec-manifest.v3.schema.json) persists artifact/source
identity, normalized source hash, optional source blob, entity count,
representation, parser and ID algorithms, and exceptional `idOverrides`.
Positions, titles, content hashes, semantic keys, and the expanded block list
are materialized from source. Ordinary entities need no per-entity stored entry;
legacy exceptions can make the override map grow.

Indexing uses Git index-blob identity for unchanged tracked documents and
normalized source hashes for other cache checks. `vlab spec index --force`
rebuilds when a cache would otherwise keep the manifest. Source alone can recover
content and ordinary derived structure, but losing the manifest can lose
artifact identity and exceptional IDs. Content recoverability does not imply
identity recoverability.

`vlab spec benchmark` measures source/manifest bytes, compression, sparse versus
expanded storage, and cold/warm indexing. It supplies reproducible storage
evidence; it does not by itself qualify another format or corpus.

## Acceptance evidence

An adapter proposal must link its specification, implementation, and fixtures
covering every row above, including refusal and old/new-version cases. Existing
Markdown coverage is in [test/integration.test.js](../test/integration.test.js),
including sparse indexing, legacy-ID migration, independent-section edits,
same-section conflicts, moves, delete-versus-edit, and stale metadata.

The [shared semantic fixture suite](semantic-conformance/README.md) checks
ordered inputs, entity boundaries, exact decisions and rendered bytes,
repeatability, and read-only planning. It includes explicit characterizations of
the unresolved #51 fence defect; passing them does not claim fence correctness.
It is distinct from the [human/JSON conformance suite](conformance/README.md).
A second format requires the shared suite and corresponding adapter evidence,
including resolution of applicable known defects, before acceptance.
