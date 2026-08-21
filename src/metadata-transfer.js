import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginGitMetrics,
  endGitMetrics,
  readGitObjects,
  refExists,
  repoContext,
  resolveRevision,
  runGit,
} from "./git.js";
import { sha256 } from "./ids.js";
import {
  canonicalJson,
  lineageRelation,
  metadataSnapshot,
  repositoryLineage,
} from "./metadata.js";
import {
  buildEnvelopeManifest,
  ENVELOPE_BUNDLE,
  readEnvelope,
  writeEnvelopeManifest,
} from "./metadata-envelope.js";
import { referencedObjectsForRecord } from "./schemas.js";
import { CliError } from "./errors.js";

const NOTES_REF = "refs/notes/vcs-lab";
const RESOLUTION_PREFIX = "refs/vcs-lab/resolutions/";

function groupRecords(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const records = grouped.get(entry.attachment) ?? [];
    records.push(entry.record);
    grouped.set(entry.attachment, records);
  }
  for (const records of grouped.values()) {
    records.sort((left, right) =>
      String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) ||
      String(left.id ?? "").localeCompare(String(right.id ?? "")) ||
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  }
  return grouped;
}

function notePath(attachment) {
  return `${attachment.slice(0, 2)}/${attachment.slice(2)}`;
}

function buildNotesCommit(entries, cwd, options = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vlab-metadata-index-"));
  const indexPath = path.join(temporary, "index");
  const env = {
    GIT_INDEX_FILE: indexPath,
    ...(options.deterministic ? {
      GIT_AUTHOR_NAME: "vcs-lab metadata envelope",
      GIT_AUTHOR_EMAIL: "metadata-envelope@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_NAME: "vcs-lab metadata envelope",
      GIT_COMMITTER_EMAIL: "metadata-envelope@example.invalid",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    } : {}),
  };
  try {
    if (options.baseRef) {
      runGit(["read-tree", `${options.baseRef}^{tree}`], { cwd, env });
    } else {
      runGit(["read-tree", "--empty"], { cwd, env });
    }
    for (const [attachment, records] of groupRecords(entries)) {
      const body = `${JSON.stringify({ schema: "vcs-lab.note/v1", records }, null, 2)}\n`;
      const blob = runGit(["hash-object", "-w", "--stdin"], {
        cwd,
        env,
        input: body,
      }).stdout;
      runGit(
        ["update-index", "--add", "--cacheinfo", "100644", blob, notePath(attachment)],
        { cwd, env },
      );
    }
    const tree = runGit(["write-tree"], { cwd, env }).stdout;
    const parents = (options.parents ?? []).flatMap((parent) => ["-p", parent]);
    const commit = runGit(["commit-tree", tree, ...parents, "-F", "-"], {
      cwd,
      env,
      input: `${options.message ?? "vcs-lab metadata envelope"}\n`,
    }).stdout;
    return { tree, commit };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readRecordsFromNoteRef(ref, attachment, cwd) {
  const result = runGit(["notes", `--ref=${ref}`, "show", attachment], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok || !result.stdout) return [];
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new CliError(`Cannot merge malformed existing note on '${attachment}'.`);
  }
  if (parsed?.schema !== "vcs-lab.note/v1" || !Array.isArray(parsed.records)) {
    throw new CliError(`Cannot merge unsupported existing note on '${attachment}'.`);
  }
  return parsed.records;
}

function combineNoteEntries(existingRef, incomingEntries, cwd) {
  const combined = [];
  for (const [attachment, incoming] of groupRecords(incomingEntries)) {
    const existing = readRecordsFromNoteRef(existingRef, attachment, cwd);
    const byId = new Map();
    for (const record of existing) {
      byId.set(record.id ?? `anonymous:${sha256(canonicalJson(record))}`, record);
    }
    for (const record of incoming) {
      const key = record.id ?? `anonymous:${sha256(canonicalJson(record))}`;
      const prior = byId.get(key);
      if (prior && canonicalJson(prior) !== canonicalJson(record)) {
        throw new CliError(`Metadata record '${record.id ?? key}' conflicts during note merge.`);
      }
      if (!prior) byId.set(key, record);
    }
    for (const record of byId.values()) combined.push({ attachment, record });
  }
  return combined;
}

function safeDeleteRef(ref, cwd) {
  if (!refExists(ref, cwd)) return;
  runGit(["update-ref", "-d", ref], { cwd, allowFailure: true });
}

function portableResolutionRefs(snapshot) {
  const accepted = new Set(
    snapshot.portableRecords
      .filter((entry) => entry.record.type === "resolution")
      .map((entry) => entry.record.ref),
  );
  return snapshot.scopes.sharedPortable.resolutions.refs.filter((entry) => accepted.has(entry.ref));
}

export function exportMetadata(envelopePath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const context = repoContext(cwd);
  const directory = path.resolve(cwd, envelopePath);
  if (fs.existsSync(directory)) {
    throw new CliError(`Metadata export path already exists: '${directory}'.`);
  }
  const metrics = beginGitMetrics("metadata-export");
  const snapshot = metadataSnapshot({ cwd: context.root });
  const exportKey = sha256(canonicalJson({
    lineage: snapshot.repository.lineage,
    records: snapshot.portableRecords.map((entry) => entry.digest),
  })).slice(0, 24);
  const temporaryNoteRef = `refs/vcs-lab/exports/${exportKey}/notes`;
  let createdDirectory = false;
  try {
    fs.mkdirSync(directory);
    createdDirectory = true;
    const refs = [];
    const bundleRefs = [];
    if (snapshot.portableRecords.length) {
      const notes = buildNotesCommit(snapshot.portableRecords, context.root, {
        message: `vcs-lab metadata export ${exportKey}`,
        deterministic: true,
      });
      runGit(["update-ref", temporaryNoteRef, notes.commit], { cwd: context.root });
      refs.push({ ref: NOTES_REF, bundleRef: temporaryNoteRef, oid: notes.commit });
      bundleRefs.push(temporaryNoteRef);
    }
    for (const entry of portableResolutionRefs(snapshot)) {
      refs.push({ ref: entry.ref, bundleRef: entry.ref, oid: entry.oid });
      bundleRefs.push(entry.ref);
    }

    let payload = null;
    if (bundleRefs.length) {
      const bundlePath = path.join(directory, ENVELOPE_BUNDLE);
      runGit(["bundle", "create", bundlePath, ...bundleRefs], { cwd: context.root });
      const bytes = fs.readFileSync(bundlePath);
      payload = {
        file: ENVELOPE_BUNDLE,
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
    }
    const manifest = buildEnvelopeManifest(snapshot, payload, refs);
    writeEnvelopeManifest(directory, manifest);
    const git = endGitMetrics(metrics);
    return {
      schema: "vcs-lab.metadata-export/v1",
      path: directory,
      manifest: path.join(directory, "manifest.json"),
      payload: payload ? path.join(directory, payload.file) : null,
      records: manifest.records.length,
      refs: manifest.refs.length,
      quarantinedRecords: snapshot.scopes.sharedPortable.notes.quarantinedCount,
      bytes: payload?.bytes ?? 0,
      git,
      trust: manifest.trust,
    };
  } catch (error) {
    endGitMetrics(metrics);
    if (createdDirectory) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    safeDeleteRef(temporaryNoteRef, context.root);
  }
}

function initInspectionRepository() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vlab-envelope-inspect-"));
  const repo = path.join(parent, "repo");
  fs.mkdirSync(repo);
  runGit(["init", "-b", "main"], { cwd: repo });
  runGit(["config", "user.name", "vcs-lab metadata inspector"], { cwd: repo });
  runGit(["config", "user.email", "metadata-inspector@example.invalid"], { cwd: repo });
  return { parent, repo };
}

function manifestRecordSummary(entry) {
  return {
    attachment: entry.attachment,
    id: entry.record.id,
    schema: entry.record.schema,
    type: entry.record.type,
    digest: entry.digest,
    ref: entry.record.type === "resolution" ? entry.record.ref : null,
    resultBlob: entry.record.type === "resolution" ? entry.record.resultBlob : null,
  };
}

function inspectEnvelopePayload(envelope) {
  if (!envelope.bundlePath) return { records: [], refs: [] };
  const temporary = initInspectionRepository();
  try {
    const refspecs = envelope.manifest.refs.map((entry) => `${entry.bundleRef}:${entry.ref}`);
    runGit(["fetch", "--no-tags", envelope.bundlePath, ...refspecs], {
      cwd: temporary.repo,
    });
    const snapshot = metadataSnapshot({
      cwd: temporary.repo,
      portableOnly: true,
      validateAttachments: false,
      validateReferences: false,
    });
    const actualRecords = snapshot.portableRecords.map(manifestRecordSummary);
    if (canonicalJson(actualRecords) !== canonicalJson(envelope.manifest.records)) {
      throw new CliError("Metadata envelope record inventory does not match its Git payload.");
    }
    const refs = envelope.manifest.refs.map((entry) => {
      const result = runGit(["show-ref", "--verify", "--hash", entry.ref], {
        cwd: temporary.repo,
        allowFailure: true,
      });
      if (!result.ok || result.stdout !== entry.oid) {
        throw new CliError(`Metadata envelope ref '${entry.ref}' does not match its manifest.`);
      }
      return entry;
    });
    return { records: snapshot.portableRecords, refs };
  } finally {
    fs.rmSync(temporary.parent, { recursive: true, force: true });
  }
}

function destinationObjectProblems(records, cwd) {
  const required = [];
  for (const entry of records) {
    const record = entry.record;
    if (record.type !== "resolution") {
      required.push({ oid: entry.attachment, type: "commit", record: record.id, field: "attachment" });
    }
    for (const reference of referencedObjectsForRecord(record)) {
      if (
        record.type === "resolution" &&
        ["resolutionCommit", "resultBlob"].includes(reference.field)
      ) continue;
      required.push({ ...reference, record: record.id });
    }
  }
  const unique = [...new Set(required.map((entry) => entry.oid))].sort();
  const objects = readGitObjects(unique, cwd);
  const lookup = new Map(unique.map((oid, index) => [oid, objects[index]]));
  return required
    .filter((entry) => {
      const object = lookup.get(entry.oid);
      return !object?.exists || object.type !== entry.type;
    })
    .map((entry) => ({
      code: "missing-referenced-object",
      record: entry.record,
      field: entry.field,
      oid: entry.oid,
      expectedType: entry.type,
    }));
}

function importPreview(envelope, incoming, cwd) {
  const context = repoContext(cwd);
  if (envelope.manifest.repository.objectFormat !== context.objectFormat) {
    throw new CliError(
      `Envelope object format '${envelope.manifest.repository.objectFormat}' is incompatible with '${context.objectFormat}'.`,
    );
  }
  const destinationLineage = repositoryLineage(cwd);
  const relation = lineageRelation(envelope.manifest.repository.lineage, destinationLineage);
  if (!['same', 'fork'].includes(relation)) {
    throw new CliError(
      `Metadata envelope lineage is ${relation}; v1 import requires a shared root commit.`,
    );
  }
  const destination = metadataSnapshot({ cwd });
  const existingById = new Map(
    destination.portableRecords.map((entry) => [entry.record.id, entry]),
  );
  const records = incoming.records.map((entry) => {
    const existing = existingById.get(entry.record.id);
    return {
      id: entry.record.id,
      schema: entry.record.schema,
      type: entry.record.type,
      attachment: entry.attachment,
      digest: entry.digest,
      action: !existing ? "add" : existing.digest === entry.digest ? "noop" : "conflict",
    };
  });
  const hasRecordAdds = records.some((entry) => entry.action === "add");
  const refs = incoming.refs.map((entry) => {
    const current = runGit(["show-ref", "--verify", "--hash", entry.ref], {
      cwd,
      allowFailure: true,
    });
    let action = "create";
    if (entry.ref === NOTES_REF && current.ok) action = hasRecordAdds ? "merge" : "noop";
    else if (current.ok && current.stdout === entry.oid) action = "noop";
    else if (current.ok) action = "conflict";
    return { ref: entry.ref, incoming: entry.oid, existing: current.ok ? current.stdout : null, action };
  });
  const objectProblems = destinationObjectProblems(incoming.records, cwd);
  const conflicts = records.filter((entry) => entry.action === "conflict").length +
    refs.filter((entry) => entry.action === "conflict").length + objectProblems.length;
  return {
    schema: "vcs-lab.metadata-import-preview/v1",
    path: envelope.directory,
    repository: {
      objectFormat: context.objectFormat,
      lineageRelation: relation,
      sourceLineage: envelope.manifest.repository.lineage.id,
      destinationLineage: destinationLineage.id,
    },
    records,
    refs,
    objectProblems,
    summary: {
      addRecords: records.filter((entry) => entry.action === "add").length,
      noopRecords: records.filter((entry) => entry.action === "noop").length,
      createRefs: refs.filter((entry) => entry.action === "create").length,
      mergeRefs: refs.filter((entry) => entry.action === "merge").length,
      noopRefs: refs.filter((entry) => entry.action === "noop").length,
      conflicts,
      applicable: conflicts === 0,
    },
    exclusions: envelope.manifest.excludedScopes,
    trust: envelope.manifest.trust,
  };
}

function stageEnvelopeRefs(envelope, cwd) {
  const stageId = `${sha256(envelope.manifest.integrity.manifestHash).slice(0, 16)}-${process.pid}`;
  const staged = envelope.manifest.refs.map((entry, index) => ({
    ...entry,
    stageRef: `refs/vcs-lab/import-staging/${stageId}/${String(index).padStart(4, "0")}`,
  }));
  for (const entry of staged) {
    if (refExists(entry.stageRef, cwd)) {
      throw new CliError(`Import staging ref already exists: '${entry.stageRef}'.`);
    }
  }
  runGit(
    ["fetch", "--no-tags", envelope.bundlePath, ...staged.map((entry) => `${entry.bundleRef}:${entry.stageRef}`)],
    { cwd },
  );
  for (const entry of staged) {
    if (resolveRevision(entry.stageRef, cwd) !== entry.oid) {
      throw new CliError(`Staged metadata ref '${entry.ref}' changed during import.`);
    }
  }
  return staged;
}

function deleteStagedRefs(staged, cwd) {
  for (const entry of staged) safeDeleteRef(entry.stageRef, cwd);
}

function applyImport(envelope, incoming, preview, cwd) {
  if (!preview.summary.applicable) {
    throw new CliError("Metadata import has conflicts; no destination refs were changed.");
  }
  if (!envelope.bundlePath || incoming.refs.length === 0) {
    return { ...preview, schema: "vcs-lab.metadata-import/v1", applied: true, changed: false };
  }
  const staged = stageEnvelopeRefs(envelope, cwd);
  try {
    const commands = ["start"];
    const notesStage = staged.find((entry) => entry.ref === NOTES_REF);
    const existingNotes = runGit(["show-ref", "--verify", "--hash", NOTES_REF], {
      cwd,
      allowFailure: true,
    });
    const notesPreview = preview.refs.find((entry) => entry.ref === NOTES_REF);
    if (notesStage && notesPreview?.action !== "noop") {
      if (!existingNotes.ok) {
        commands.push(`create ${NOTES_REF} ${notesStage.oid}`);
      } else {
        const combined = combineNoteEntries(NOTES_REF, incoming.records, cwd);
        const existingTree = runGit(["rev-parse", `${NOTES_REF}^{tree}`], { cwd }).stdout;
        const merged = buildNotesCommit(combined, cwd, {
          baseRef: NOTES_REF,
          parents: [existingNotes.stdout, notesStage.oid],
          message: `Import vcs-lab metadata ${envelope.manifest.integrity.manifestHash.slice(0, 16)}`,
        });
        if (merged.tree !== existingTree) {
          commands.push(`update ${NOTES_REF} ${merged.commit} ${existingNotes.stdout}`);
        }
      }
    }
    for (const entry of staged.filter((item) => item.ref.startsWith(RESOLUTION_PREFIX))) {
      const current = runGit(["show-ref", "--verify", "--hash", entry.ref], {
        cwd,
        allowFailure: true,
      });
      if (!current.ok) {
        commands.push(`create ${entry.ref} ${entry.oid}`);
      } else if (current.stdout !== entry.oid) {
        throw new CliError(`Resolution ref '${entry.ref}' changed or conflicts during import.`);
      }
    }
    for (const entry of staged) commands.push(`delete ${entry.stageRef} ${entry.oid}`);
    commands.push("prepare", "commit");
    runGit(["update-ref", "--stdin"], { cwd, input: `${commands.join("\n")}\n` });
    return {
      ...preview,
      schema: "vcs-lab.metadata-import/v1",
      applied: true,
      changed: preview.summary.addRecords > 0 || preview.summary.createRefs > 0 || preview.summary.mergeRefs > 0,
    };
  } catch (error) {
    deleteStagedRefs(staged, cwd);
    throw error;
  }
}

export function importMetadata(envelopePath, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (Boolean(options.dryRun) === Boolean(options.apply)) {
    throw new CliError("Choose exactly one of --dry-run or --apply for metadata import.");
  }
  const metrics = beginGitMetrics("metadata-import");
  try {
    const envelope = readEnvelope(path.resolve(cwd, envelopePath));
    const incoming = inspectEnvelopePayload(envelope);
    const preview = importPreview(envelope, incoming, cwd);
    const result = options.dryRun
      ? preview
      : applyImport(envelope, incoming, preview, cwd);
    result.metrics = {
      payloadBytes: envelope.manifest.payload?.bytes ?? 0,
      git: endGitMetrics(metrics),
    };
    return result;
  } catch (error) {
    endGitMetrics(metrics);
    throw error;
  }
}
