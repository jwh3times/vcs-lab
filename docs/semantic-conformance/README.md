# Semantic-merge conformance

[fixtures.json](fixtures.json) is the shared semantic-merge fixture catalog for
FR-SPEC-13. It exercises the [adapter contract](../structured-document-adapters.md)
against the real CLI. It is separate from
[human/JSON conformance](../conformance/README.md), which checks presentation.

Run `node --test test/semantic-conformance.test.js`, or `npm test` for the full
suite. Fixtures use disposable Git repositories and require no remote service.
The caller's selected Git session and read engine are honored. The ordinary CI
suite runs the fixtures on Windows and Ubuntu; manual qualification also runs
them in the forced modes described in [testing.md](../testing.md).

## Fixture contract

The catalog is versioned as `vcs-lab.semantic-conformance-fixtures/v1`. It is a
test artifact, not a new runtime record family. Each profile names its parser,
merge algorithm, and writer manifest version. Top-level `coverage` lists shared
rules; profile `coverage` adds format-specific cases such as Markdown heading
boundaries. Every profile must cover every shared rule and its own declared
rules. Missing rules, undeclared rules, duplicate case IDs, or profiles without
runners fail the suite.

Each case contains:

| Field | Meaning |
| --- | --- |
| `id`, `rule`, `profile` | Stable case name, coverage obligation, and adapter/version profile |
| `stages` | Ordered `base`, `ours` (target), and `theirs` (source) inputs |
| Stage `text` | Literal source text, with JSON escapes preserving CR, LF, tabs, and trailing spaces; null means absent |
| Stage `entities` | Exact ordered semantic keys expected from indexing, including query-only entities |
| Stage optional inputs | `artifactId`, `idOverrides`, and `metadata` construct identity and compatibility/refusal cases |
| `expected` | Exact observable plan: status, decision counts, ordering decision, sorted conflict types, and result |
| Result | Null for a blocked plan; otherwise deletion flag, literal rendered text, and ordered result entity keys |
| `knownFailure` | Issue, reason, and separate desired observation for an explicitly tracked defect |

Expected text and classifications are authored examples. They are not generated
from a run or recomputed with the parser/merge implementation. Comparing complete
projected observations catches both missing and extra decisions, blockers, and
entities, as well as any changed rendered byte. Variable diagnostics and random
IDs are not snapshots: IDs are checked for preservation across matching keys
and against the inputs selected into the result.

The Markdown runner in
[test-support/semantic-conformance.js](../../test-support/semantic-conformance.js)
creates committed stages through `vlab spec index` and observes materialized
entities through `vlab spec show`. It constructs malformed, stale, future-version,
and legacy metadata only as fixture inputs. It invokes `vlab spec merge-plan`
twice on identical ordered revisions, requiring identical output and unchanged
HEAD/worktree state. Indexing must preserve the original document bytes and
write sparse manifests. Production parser and merge internals are not imported.

The legacy-v2 case supplies a deliberately exceptional ID and checks that merge
preserves it in a v3 result. Broader migration, resource-bound, forecast,
application, and recovery coverage remains in the integration and hostile-input
suites. This fixture suite does not replace those workflow tests.

## Known fenced-code defect

Cases marked `knownFailure` are **defect characterizations, not successful
conformance**. They pin the exact observed v1 behavior and separately record the
desired entity boundaries and plan. They execute normally: no skip, TODO,
catch-all expected exception, or broad expected-failure wrapper can conceal a
new failure. Their test names identify the defect. A changed observation fails
even if it is an improvement, requiring an explicit fixture and version review;
a desired observation identical to the pinned one is rejected as a stale defect.

[#51](https://github.com/jwh3times/vcs-lab/issues/51) owns the correction. Current
v1 parsing can treat headings and requirement declarations in fenced examples as
entities, insert a blank line inside the example, and falsely combine divergent
edits within one real section. The fixtures cover backticks and tildes, longer
fences, three-space indentation, shorter and mismatched closers, unclosed fences,
and same-section divergence. A four-space opening is recorded separately as an
indentation-boundary characterization, not as a valid fenced block. A clean
example checks preservation of interior spaces and indented code comments.

The desired fence observations are regression targets for #51, not an accepted
new parser version or a complete syntax standard. #51 must settle the exact
supported syntax, parser/version migration, and reuse treatment before those
targets become the supported profile. A green run here does not clear that gate
or qualify the current Markdown parser for every literal construct.

## Extending the suite

Add an independently worked input and literal expectation for a new behavior,
then run the focused suite. Update coverage deliberately; deleting its only case
must not silently remove an obligation. Do not record current output as an
oracle to make a failing case green.

For a new adapter, add a profile and runner that supplies the same observable
shape through its public interface. Supply native-format inputs for every shared
rule and declare its own format-specific rules. The runner mapping and profile
catalog must agree in both directions. Define entity keys, merge units, ordering,
rendering, and compatibility in that adapter's specification; the shared suite
does not require other formats to use Markdown headings. A second adapter still
needs the full acceptance evidence in the adapter contract, including resolution
of applicable known defects.
