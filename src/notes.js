import { runGit } from "./git.js";

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
    if (Array.isArray(parsed.records)) {
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
  const result = runGit(["notes", `--ref=${NOTES_REF}`, "list"], {
    cwd,
    allowFailure: true,
  });
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean);
}

export function listNoteRecords(cwd = process.cwd()) {
  const records = [];
  for (const target of listNoteTargets(cwd)) {
    for (const record of readNote(target, cwd).records) {
      records.push({ ...record, attachedTo: target });
    }
  }
  return records.sort((left, right) =>
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
  );
}

export function recordsReachableFrom(ref, cwd = process.cwd()) {
  const records = [];
  for (const target of listNoteTargets(cwd)) {
    const reachable = runGit(["merge-base", "--is-ancestor", target, ref], {
      cwd,
      allowFailure: true,
    }).ok;
    if (!reachable) continue;
    for (const record of readNote(target, cwd).records) {
      records.push({ ...record, attachedTo: target });
    }
  }
  return records;
}
