import { runGit } from "./git.js";
import {
  listNoteEntries as listNotes,
  reachableCommits,
  readGitObjects,
  readNoteText,
} from "./engine.js";
import { CliError } from "./errors.js";
import { RESOURCE_BOUNDS, withinBound } from "./schemas.js";

export const NOTES_REF = "vcs-lab";

const NOTE_SCHEMA = "vcs-lab.note/v1";

function emptyNote() {
  return { schema: NOTE_SCHEMA, records: [] };
}

/**
 * Classify one note's text. This is the single note parser shared by
 * `readNote`, `readNotes`, `listNoteRecords`, and `appendNote` so the
 * resolution catalog, receipts, and note rewriting cannot disagree about a
 * note's shape. Notes are shared-portable and arrive by fetch from clones that
 * may run another vcs-lab build, so every disposition here is non-fatal on read
 * (ADR-0020):
 *
 * - `accept`: a versioned `vcs-lab.note/v1` container within its bounds.
 * - `legacy`: unparsable text, preserved as one opaque record so a rewrite
 *   cannot lose it.
 * - `foreign`: valid JSON that is not a `vcs-lab.note/v1` container (a future
 *   container version, or a bare array of records, which `metadata validate`
 *   rejects as malformed). It yields no records and must not be rewritten.
 * - `oversize`: over `noteContainerBytes` or `noteContainerRecords`. It is
 *   quarantined unparsed rather than loaded, so an untrusted note cannot force
 *   unbounded work.
 */
function classifyNoteText(text) {
  if (!text) return { note: emptyNote(), disposition: "empty" };
  if (!withinBound("noteContainerBytes", Buffer.byteLength(text, "utf8"))) {
    return { note: emptyNote(), disposition: "oversize" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Preserve an existing non-vlab note as an opaque legacy record.
    return {
      note: { schema: NOTE_SCHEMA, records: [{ type: "legacy-note", text }] },
      disposition: "legacy",
    };
  }
  if (parsed?.schema !== NOTE_SCHEMA || !Array.isArray(parsed.records)) {
    return { note: emptyNote(), disposition: "foreign" };
  }
  if (!withinBound("noteContainerRecords", parsed.records.length)) {
    return { note: emptyNote(), disposition: "oversize" };
  }
  return { note: parsed, disposition: "accept" };
}

function parseNoteText(text) {
  return classifyNoteText(text).note;
}

export function readNote(commit, cwd = process.cwd()) {
  const text = readNoteText(NOTES_REF, commit, cwd);
  if (text === null) return emptyNote();
  return parseNoteText(text);
}

/**
 * Read the notes attached to several objects with two bounded Git queries
 * (one note listing plus one batched object read) instead of one
 * `git notes show` process per object. Every requested object maps to a note
 * container; objects without a readable note map to an empty container,
 * matching `readNote`.
 */
export function readNotes(objects, cwd = process.cwd()) {
  const notes = new Map();
  for (const object of objects) notes.set(object, emptyNote());
  if (notes.size === 0) return notes;
  const entries = listNoteEntries(cwd).filter((entry) => notes.has(entry.target));
  if (entries.length === 0) return notes;
  const blobs = readGitObjects(entries.map((entry) => entry.note), cwd);
  for (let index = 0; index < entries.length; index += 1) {
    const blob = blobs[index];
    if (!blob.exists || blob.type !== "blob") continue;
    notes.set(
      entries[index].target,
      parseNoteText(blob.content.toString("utf8").trim()),
    );
  }
  return notes;
}

/**
 * Append one record to a commit's note container. `git notes add -f` replaces
 * the whole blob, so this refuses to rewrite a note it could not fully read:
 * a container of another version, or one over a published resource bound,
 * would otherwise be destroyed by the rewrite (ADR-0020). Publishing a receipt
 * fails closed instead, leaving the existing note byte-for-byte intact.
 */
export function appendNote(commit, record, cwd = process.cwd()) {
  const text = readNoteText(NOTES_REF, commit, cwd);
  const { note, disposition } = classifyNoteText(text === null ? "" : text);
  if (disposition === "foreign") {
    throw new CliError(
      `The note on '${commit}' is not a ${NOTE_SCHEMA} container.`,
      {
        details:
          "vcs-lab will not overwrite a note container it cannot read. Inspect it " +
          `with: git notes --ref=${NOTES_REF} show ${commit}`,
      },
    );
  }
  if (disposition === "oversize") {
    throw new CliError(
      `The note on '${commit}' exceeds a published note-container resource bound.`,
      {
        details:
          `Notes are limited to ${RESOURCE_BOUNDS.noteContainerBytes} bytes and ` +
          `${RESOURCE_BOUNDS.noteContainerRecords} records; see docs/schemas/compatibility.md.`,
      },
    );
  }
  note.records.push(record);
  if (!withinBound("noteContainerRecords", note.records.length)) {
    throw new CliError(
      `The note on '${commit}' would exceed the noteContainerRecords bound of ` +
      `${RESOURCE_BOUNDS.noteContainerRecords}.`,
    );
  }
  runGit(
    ["notes", `--ref=${NOTES_REF}`, "add", "-f", "-F", "-", commit],
    { cwd, input: `${JSON.stringify(note, null, 2)}\n` },
  );
  return note;
}

export function listNoteTargets(cwd = process.cwd()) {
  return listNoteEntries(cwd).map((entry) => entry.target);
}

function listNoteEntries(cwd = process.cwd()) {
  return listNotes(NOTES_REF, cwd);
}

function recordsForEntries(entries, cwd) {
  if (entries.length === 0) return [];
  const objects = readGitObjects(entries.map((entry) => entry.note), cwd);
  const records = [];
  for (let index = 0; index < entries.length; index += 1) {
    const object = objects[index];
    if (!object.exists || object.type !== "blob") continue;
    const note = parseNoteText(object.content.toString("utf8").trim());
    for (const record of note.records) {
      records.push({ ...record, attachedTo: entries[index].target });
    }
  }
  return records;
}

export function listNoteRecords(cwd = process.cwd()) {
  return recordsForEntries(listNoteEntries(cwd), cwd).sort((left, right) =>
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
  );
}

export function recordsReachableFrom(
  ref,
  cwd = process.cwd(),
  reachableCommits = null,
) {
  let reachable = reachableCommits;
  if (!reachable) {
    reachable = new Set(reachableCommits(ref, cwd));
  }
  const entries = listNoteEntries(cwd).filter((entry) =>
    reachable.has(entry.target),
  );
  return recordsForEntries(entries, cwd);
}
