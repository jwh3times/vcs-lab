import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./ids.js";
import { canonicalJson } from "./metadata.js";
import { METADATA_ENVELOPE_SCHEMA, isOid } from "./schemas.js";
import { VERSION } from "./version.js";
import { CliError } from "./errors.js";

export const ENVELOPE_MANIFEST = "manifest.json";
export const ENVELOPE_BUNDLE = "objects.bundle";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;

function validRef(ref) {
  return (
    typeof ref === "string" &&
    ref.startsWith("refs/") &&
    !/[\x00-\x20\x7f]/.test(ref) &&
    !["~", "^", ":", "?", "*", "[", "\\"].some((character) => ref.includes(character)) &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    !ref.endsWith(".") &&
    !ref.endsWith("/") &&
    !ref.includes("//")
  );
}

function manifestHash(value) {
  const copy = structuredClone(value);
  delete copy.integrity;
  return sha256(canonicalJson(copy));
}

export function buildEnvelopeManifest(snapshot, payload, refs) {
  const records = snapshot.portableRecords.map((entry) => ({
    attachment: entry.attachment,
    id: entry.record.id,
    schema: entry.record.schema,
    type: entry.record.type,
    digest: entry.digest,
    ref: entry.record.type === "resolution" ? entry.record.ref : null,
    resultBlob: entry.record.type === "resolution" ? entry.record.resultBlob : null,
  }));
  const manifest = {
    schema: METADATA_ENVELOPE_SCHEMA,
    producer: { name: "causal-vcs-lab", version: VERSION },
    repository: {
      objectFormat: snapshot.repository.objectFormat,
      lineage: snapshot.repository.lineage,
    },
    capabilities: [
      "causal-notes/v1",
      "causal-rebase/v1",
      "exact-resolutions/v1",
      "metadata-integrity/v1",
    ],
    includedNamespaces: [
      "refs/notes/vcs-lab",
      "refs/vcs-lab/resolutions/*",
    ],
    excludedScopes: [
      "tracked-portable/spec-manifests (moves with ordinary Git content)",
      "shared-local/workspaces",
      "shared-local/checkpoints",
      "worktree-private/reconciliations",
      "worktree-private/rebases",
      "worktree-private/forecasts",
    ],
    refs: [...refs].sort((left, right) => left.ref.localeCompare(right.ref)),
    records,
    payload,
    trust: {
      cryptographicallySigned: false,
      authorized: false,
      statement: "Hashes and Git object IDs establish integrity only, not actor identity or authorization.",
    },
  };
  manifest.integrity = {
    algorithm: "sha256",
    manifestHash: manifestHash(manifest),
  };
  return manifest;
}

function validateManifestShape(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CliError("Metadata envelope manifest must be a JSON object.");
  }
  if (manifest.schema !== METADATA_ENVELOPE_SCHEMA) {
    throw new CliError(
      `Unsupported metadata envelope schema '${manifest.schema ?? "(missing)"}'.`,
    );
  }
  if (!Array.isArray(manifest.refs) || !Array.isArray(manifest.records)) {
    throw new CliError("Metadata envelope manifest has invalid refs or records.");
  }
  if (!manifest.repository?.objectFormat || !manifest.repository?.lineage) {
    throw new CliError("Metadata envelope manifest has no repository lineage.");
  }
  if (!["sha1", "sha256"].includes(manifest.repository.objectFormat)) {
    throw new CliError("Metadata envelope declares an unsupported Git object format.");
  }
  const objectFormat = manifest.repository.objectFormat;
  if (
    !Array.isArray(manifest.repository.lineage.rootCommits) ||
    !manifest.repository.lineage.rootCommits.every((oid) => isOid(oid, objectFormat))
  ) {
    throw new CliError("Metadata envelope has malformed lineage anchors.");
  }
  const logicalRefs = new Set();
  const bundleRefs = new Set();
  for (const entry of manifest.refs) {
    if (
      !entry ||
      !validRef(entry.ref) ||
      !validRef(entry.bundleRef) ||
      !isOid(entry.oid, objectFormat) ||
      !(entry.ref === "refs/notes/vcs-lab" || entry.ref.startsWith("refs/vcs-lab/resolutions/"))
    ) {
      throw new CliError("Metadata envelope contains an invalid or unsupported ref entry.");
    }
    if (logicalRefs.has(entry.ref) || bundleRefs.has(entry.bundleRef)) {
      throw new CliError("Metadata envelope contains duplicate refs.");
    }
    logicalRefs.add(entry.ref);
    bundleRefs.add(entry.bundleRef);
  }
  if (manifest.records.length > 1_000_000) {
    throw new CliError("Metadata envelope record inventory exceeds the supported limit.");
  }
  for (const record of manifest.records) {
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.schema !== "string" ||
      typeof record.type !== "string" ||
      !isOid(record.attachment, objectFormat) ||
      !/^[0-9a-f]{64}$/i.test(record.digest)
    ) {
      throw new CliError("Metadata envelope contains a malformed record inventory entry.");
    }
    if (record.ref !== null && (!validRef(record.ref) || !record.ref.startsWith("refs/vcs-lab/resolutions/"))) {
      throw new CliError("Metadata envelope contains a malformed resolution record ref.");
    }
  }
  if (
    manifest.integrity?.algorithm !== "sha256" ||
    manifest.integrity?.manifestHash !== manifestHash(manifest)
  ) {
    throw new CliError("Metadata envelope manifest integrity check failed.");
  }
}

export function writeEnvelopeManifest(directory, manifest) {
  fs.writeFileSync(
    path.join(directory, ENVELOPE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function readEnvelope(envelopePath) {
  const directory = path.resolve(envelopePath);
  let manifest;
  try {
    const manifestPath = path.join(directory, ENVELOPE_MANIFEST);
    if (fs.statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      throw new CliError("Metadata envelope manifest exceeds the supported size limit.");
    }
    manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CliError(`Metadata envelope not found at '${directory}'.`);
    }
    if (error instanceof SyntaxError) {
      throw new CliError("Metadata envelope manifest is not valid JSON.");
    }
    throw error;
  }
  validateManifestShape(manifest);
  const bundlePath = manifest.payload ? path.join(directory, manifest.payload.file) : null;
  if (manifest.payload) {
    if (manifest.payload.file !== ENVELOPE_BUNDLE || !fs.existsSync(bundlePath)) {
      throw new CliError("Metadata envelope payload is missing.");
    }
    if (
      !Number.isSafeInteger(manifest.payload.bytes) ||
      manifest.payload.bytes < 0 ||
      manifest.payload.bytes > MAX_BUNDLE_BYTES ||
      !/^[0-9a-f]{64}$/i.test(manifest.payload.sha256)
    ) {
      throw new CliError("Metadata envelope payload declaration is invalid or too large.");
    }
    const size = fs.statSync(bundlePath).size;
    if (size !== manifest.payload.bytes) {
      throw new CliError("Metadata envelope payload integrity check failed.");
    }
    const bytes = fs.readFileSync(bundlePath);
    if (bytes.length !== manifest.payload.bytes || sha256(bytes) !== manifest.payload.sha256) {
      throw new CliError("Metadata envelope payload integrity check failed.");
    }
  } else if (manifest.refs.length || manifest.records.length) {
    throw new CliError("Metadata envelope declares records without a Git payload.");
  }
  return { directory, manifest, bundlePath };
}
