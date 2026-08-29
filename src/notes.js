import { readGitObjects, runGit } from "./git.js";

export const NOTES_REF = "vcs-lab";

const NOTE_SCHEMA = "vcs-lab.note/v1";

function emptyNote() {
  return { schema: NOTE_SCHEMA, records: [] };
}

/**
 * Parse one note's trimmed text. This is the single note parser shared by
 * `readNote`, `readNotes`, and `listNoteRecords` so the resolution catalog,
 * receipts, and note rewriting cannot disagree about a note's shape: only a
 * versioned `vcs-lab.note/v1` container yields records, an unparsable note
 * becomes an opaque legacy record so it is preserved on rewrite, and any other
 * JSON shape (including a bare array of records, which `metadata validate`
 * rejects as a malformed container) yields no records.
 */
function parseNoteText(text) {
  if (!text) return emptyNote();
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schema === NOTE_SCHEMA && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // Preserve an existing non-vlab note as an opaque legacy record.
    return {
      schema: NOTE_SCHEMA,
      records: [{ type: "legacy-note", text }],
    };
  }
  return emptyNote();
}

export function readNote(commit, cwd = process.cwd()) {
  const result = runGit(["notes", `--ref=${NOTES_REF}`, "show", commit], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok) return emptyNote();
  return parseNoteText(result.stdout);
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

export function appendNote(commit, record, cwd = process.cwd()) {
  const note = readNote(commit, cwd);
  note.records.push(record);
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
  const result = runGit(["notes", `--ref=${NOTES_REF}`, "list"], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [note, target] = line.trim().split(/\s+/);
      return note && target ? { note, target } : null;
    })
    .filter(Boolean);
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
    const output = runGit(["rev-list", ref], { cwd }).stdout;
    reachable = new Set(output ? output.split(/\r?\n/).filter(Boolean) : []);
  }
  const entries = listNoteEntries(cwd).filter((entry) =>
    reachable.has(entry.target),
  );
  return recordsForEntries(entries, cwd);
}
