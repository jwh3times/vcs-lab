import { sha256 } from "./ids.js";

export const NOTE_CONTAINER_SCHEMA = "vcs-lab.note/v1";
export const METADATA_STATUS_SCHEMA = "vcs-lab.metadata-status/v1";
export const METADATA_VALIDATION_SCHEMA = "vcs-lab.metadata-validation/v1";
export const METADATA_ENVELOPE_SCHEMA = "vcs-lab.metadata-envelope/v1";
export const METADATA_LINEAGE_ALGORITHM = "git-root-commits-sha256/v1";
export const RESOLUTION_SIGNATURE_ALGORITHM = "ordered-three-way-blobs/v1";

const KNOWN_SCHEMAS = new Map([
  ["vcs-lab.note/v1", "note-container"],
  ["vcs-lab.landing/v1", "note-record"],
  ["vcs-lab.application/v1", "note-record"],
  ["vcs-lab.application/v4", "note-record"],
  ["vcs-lab.reconciliation/v6", "note-record"],
  ["vcs-lab.resolution/v1", "note-record"],
  ["vcs-lab.reconciliation-operation/v4", "private"],
  ["vcs-lab.forecast/v2", "private"],
  ["vcs-lab.workspaces/v1", "shared-local"],
  ["vcs-lab.workspace/v1", "shared-local"],
  ["vcs-lab.spec-manifest/v1", "tracked"],
  ["vcs-lab.spec-manifest/v2", "tracked"],
  ["vcs-lab.spec-manifest/v3", "tracked"],
  ["vcs-lab.metadata-envelope/v1", "envelope"],
]);

export function schemaClassification(schema) {
  if (typeof schema !== "string" || !schema) {
    return { known: false, family: null, version: null, scope: null };
  }
  const match = schema.match(/^(.+)\/v(\d+)$/);
  return {
    known: KNOWN_SCHEMAS.has(schema),
    family: match?.[1] ?? null,
    version: match ? Number(match[2]) : null,
    scope: KNOWN_SCHEMAS.get(schema) ?? null,
  };
}

export function oidLength(objectFormat) {
  return objectFormat === "sha256" ? 64 : 40;
}

export function isOid(value, objectFormat) {
  return (
    typeof value === "string" &&
    new RegExp(`^[0-9a-f]{${oidLength(objectFormat)}}$`, "i").test(value)
  );
}

function fieldError(errors, condition, field, expectation) {
  if (!condition) errors.push({ field, expectation });
}

function validateCommonRecord(record, expectedType, objectFormat, errors) {
  fieldError(errors, record && typeof record === "object" && !Array.isArray(record), "$", "object");
  if (!record || typeof record !== "object" || Array.isArray(record)) return;
  fieldError(errors, typeof record.schema === "string", "schema", "versioned schema string");
  fieldError(errors, record.type === expectedType, "type", expectedType);
  fieldError(errors, typeof record.id === "string" && record.id.length > 3, "id", "non-empty record ID");
  if (record.createdAt !== undefined) {
    fieldError(errors, typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt)), "createdAt", "ISO-compatible timestamp");
  }
  if (record.attachedTo !== undefined) {
    fieldError(errors, isOid(record.attachedTo, objectFormat), "attachedTo", `${objectFormat} commit OID`);
  }
}

function requireOid(record, field, objectFormat, errors, nullable = false) {
  const value = record[field];
  fieldError(
    errors,
    (nullable && value === null) || isOid(value, objectFormat),
    field,
    nullable ? `${objectFormat} OID or null` : `${objectFormat} OID`,
  );
}

function requireOidArray(record, field, objectFormat, errors) {
  const value = record[field];
  fieldError(
    errors,
    Array.isArray(value) && value.every((item) => isOid(item, objectFormat)),
    field,
    `array of ${objectFormat} OIDs`,
  );
}

function requireStringArray(record, field, errors) {
  const value = record[field];
  fieldError(
    errors,
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0),
    field,
    "array of non-empty strings",
  );
}

function attachmentMatches(record, field, errors) {
  if (record.attachedTo !== undefined && record[field] !== record.attachedTo) {
    errors.push({ field: "attachedTo", expectation: `same OID as ${field}` });
  }
}

export function validateNoteRecord(record, objectFormat = "sha1") {
  const errors = [];
  const schema = record?.schema;
  if (!schemaClassification(schema).known || schemaClassification(schema).scope !== "note-record") {
    return [{ field: "schema", expectation: "supported causal note record schema" }];
  }

  if (schema === "vcs-lab.landing/v1") {
    validateCommonRecord(record, "landing", objectFormat, errors);
    fieldError(errors, ["compact", "hard-squash"].includes(record.mode), "mode", "compact or hard-squash");
    for (const field of ["sourceHead", "targetBefore", "landingCommit", "base", "resultTree"]) {
      requireOid(record, field, objectFormat, errors);
    }
    requireOidArray(record, "absorbedCommits", objectFormat, errors);
    requireStringArray(record, "absorbedChanges", errors);
    attachmentMatches(record, "landingCommit", errors);
  } else if (schema === "vcs-lab.application/v1") {
    validateCommonRecord(record, "application", objectFormat, errors);
    for (const field of ["originCommit", "appliedCommit", "targetBefore"]) {
      requireOid(record, field, objectFormat, errors);
    }
    for (const field of ["originChangeId", "appliedChangeId", "relation"]) {
      fieldError(errors, typeof record[field] === "string" && record[field].length > 0, field, "non-empty string");
    }
    attachmentMatches(record, "appliedCommit", errors);
  } else if (schema === "vcs-lab.application/v4") {
    validateCommonRecord(record, "application", objectFormat, errors);
    for (const field of ["originCommit", "appliedCommit", "targetBefore", "sourceTree", "resultTree"]) {
      requireOid(record, field, objectFormat, errors);
    }
    for (const field of ["originChangeId", "appliedChangeId", "relation"]) {
      fieldError(errors, typeof record[field] === "string" && record[field].length > 0, field, "non-empty string");
    }
    attachmentMatches(record, "appliedCommit", errors);
  } else if (schema === "vcs-lab.reconciliation/v6") {
    validateCommonRecord(record, "reconciliation", objectFormat, errors);
    for (const field of ["sourceHead", "targetBefore", "resultCommit", "targetTreeBefore", "sourceTree", "resultTree"]) {
      requireOid(record, field, objectFormat, errors);
    }
    requireOidArray(record, "absorbedCommits", objectFormat, errors);
    requireStringArray(record, "absorbedChanges", errors);
    fieldError(errors, Array.isArray(record.applied), "applied", "array");
    attachmentMatches(record, "resultCommit", errors);
  } else if (schema === "vcs-lab.resolution/v1") {
    validateCommonRecord(record, "resolution", objectFormat, errors);
    fieldError(errors, record.algorithm === RESOLUTION_SIGNATURE_ALGORITHM, "algorithm", RESOLUTION_SIGNATURE_ALGORITHM);
    fieldError(errors, typeof record.signature === "string" && /^rsig_[0-9a-f]{64}$/i.test(record.signature), "signature", "rsig_ SHA-256 value");
    for (const side of ["base", "ours", "theirs"]) {
      const value = record[side];
      fieldError(errors, value === null || (value && typeof value === "object"), side, "stage object or null");
      if (value) requireOid(value, "blob", objectFormat, errors);
    }
    requireOid(record, "resultBlob", objectFormat, errors, true);
    requireOid(record, "resolutionCommit", objectFormat, errors);
    fieldError(errors, typeof record.ref === "string" && record.ref.startsWith("refs/vcs-lab/resolutions/"), "ref", "resolution retention ref");
    attachmentMatches(record, "resolutionCommit", errors);
  }
  return errors;
}

export function isStructurallyValidNoteRecord(record, objectFormat = "sha1") {
  return validateNoteRecord(record, objectFormat).length === 0;
}

export function referencedObjectsForRecord(record) {
  const objects = [];
  const add = (oid, type, field) => {
    if (typeof oid === "string") objects.push({ oid, type, field });
  };
  if (record.schema === "vcs-lab.landing/v1") {
    for (const field of ["sourceHead", "targetBefore", "landingCommit", "base"]) add(record[field], "commit", field);
    for (const oid of record.absorbedCommits ?? []) add(oid, "commit", "absorbedCommits");
    add(record.resultTree, "tree", "resultTree");
  } else if (record.schema === "vcs-lab.application/v1") {
    for (const field of ["originCommit", "appliedCommit", "targetBefore"]) add(record[field], "commit", field);
  } else if (record.schema === "vcs-lab.application/v4") {
    for (const field of ["originCommit", "appliedCommit", "targetBefore"]) add(record[field], "commit", field);
    for (const field of ["sourceTree", "resultTree"]) add(record[field], "tree", field);
  } else if (record.schema === "vcs-lab.reconciliation/v6") {
    for (const field of ["sourceHead", "targetBefore", "resultCommit"]) add(record[field], "commit", field);
    for (const oid of record.absorbedCommits ?? []) add(oid, "commit", "absorbedCommits");
    for (const field of ["targetTreeBefore", "sourceTree", "resultTree"]) add(record[field], "tree", field);
  } else if (record.schema === "vcs-lab.resolution/v1") {
    add(record.resolutionCommit, "commit", "resolutionCommit");
    for (const field of ["base", "ours", "theirs"]) add(record[field]?.blob, "blob", `${field}.blob`);
    add(record.resultBlob, "blob", "resultBlob");
  }
  return objects;
}

export function resolutionSignatureFor(stages) {
  const canonical = JSON.stringify({
    algorithm: RESOLUTION_SIGNATURE_ALGORITHM,
    base: stages.base ?? null,
    ours: stages.ours ?? null,
    theirs: stages.theirs ?? null,
  });
  return `rsig_${sha256(canonical)}`;
}
