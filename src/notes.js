import { readGitObjects, runGit } from "./git.js";

export const NOTES_REF = "vcs-lab";

export function readNote(commit, cwd = process.cwd()) {
  const result = runGit(["notes", `--ref=${NOTES_REF}`, "show", commit], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok || !result.stdout) {
    return { schema: "vcs-lab.note/v1", records: [] };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) {
      return { schema: "vcs-lab.note/v1", records: parsed };
    }
    if (parsed?.schema === "vcs-lab.note/v1" && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // Preserve an existing non-vlab note as an opaque legacy record.
    return {
      schema: "vcs-lab.note/v1",
      records: [{ type: "legacy-note", text: result.stdout }],
    };
  }
  return { schema: "vcs-lab.note/v1", records: [] };
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

function parseNoteContent(content) {
  const text = content.toString("utf8").trim();
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      parsed.schema === "vcs-lab.note/v1" &&
      Array.isArray(parsed.records)
    ) return parsed;
  } catch {
    return {
      schema: "vcs-lab.note/v1",
      records: [{ type: "legacy-note", text }],
    };
  }
  return { schema: "vcs-lab.note/v1", records: [] };
}

function recordsForEntries(entries, cwd) {
  if (entries.length === 0) return [];
  const objects = readGitObjects(entries.map((entry) => entry.note), cwd);
  const records = [];
  for (let index = 0; index < entries.length; index += 1) {
    const object = objects[index];
    if (!object.exists || object.type !== "blob") continue;
    for (const record of parseNoteContent(object.content).records) {
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
