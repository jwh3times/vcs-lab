import path from "node:path";
import {
  createCommit,
  cherryPick,
  reconcile,
} from "./operations.js";
import { buildMergePlan, formatMergePlan } from "./merge-plan.js";
import { land } from "./landings.js";
import { initLab } from "./store.js";
import { runGit } from "./git.js";
import { createWorkspace, checkpointWorkspace, listWorkspaces } from "./workspaces.js";
import { indexSpec, readSpecManifest } from "./specs.js";
import { listNoteRecords } from "./notes.js";
import { CliError } from "./errors.js";

const HELP = `vcs-lab — Git-backed experiments for causal source control

Usage:
  vlab init
  vlab commit -m <message> [--all] [--allow-empty]
  vlab branch <name> [from]
  vlab merge <source> [--compact | --hard-squash] [-m <message>]
  vlab compact-merge <source> [-m <message>]
  vlab hard-squash <source> [-m <message>]
  vlab merge-plan <source> [--json]
  vlab reconcile <source> [--accept-candidates] [--json]
  vlab cherry-pick <commit-or-change-id> [--fork] [--repeat] [--json]
  vlab graph
  vlab receipts [--json]
  vlab workspace create <name> [--from <ref>] [--path <directory>]
  vlab workspace list [--json]
  vlab workspace checkpoint [--label <text>] [--json]
  vlab spec index <markdown-file> [--json]
  vlab spec show <markdown-file> [--json]
  vlab doctor

Legend for merge-plan: '=' proven covered, '?' heuristic candidate, '+' new.
`;

function parseArgs(args) {
  const positionals = [];
  const options = {};
  const valueFlags = new Set(["--message", "-m", "--from", "--path", "--owner", "--focus", "--label"]);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (valueFlags.has(item)) {
      const value = args[index + 1];
      if (value === undefined) throw new CliError(`${item} requires a value.`);
      const key = item === "-m" ? "message" : item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = value;
      index += 1;
    } else if (item.startsWith("--")) {
      options[item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else {
      positionals.push(item);
    }
  }
  return { positionals, options };
}

function requireValue(value, usage) {
  if (!value) throw new CliError(`Missing required argument. Usage: ${usage}`);
  return value;
}

function print(value, json = false) {
  if (json || typeof value !== "string") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

function formatSpecResult(result) {
  const { manifest, changes, manifestPath } = result;
  return [
    `artifact     ${manifest.artifactId}`,
    `source       ${manifest.source}`,
    `manifest     ${path.relative(process.cwd(), manifestPath)}`,
    `blocks       ${manifest.blocks.length}`,
    `changes      ${changes.added.length} added, ${changes.changed.length} changed, ${changes.moved.length} moved, ${changes.removed.length} removed`,
  ].join("\n");
}

function short(value) {
  return value ? String(value).slice(0, 12) : "-";
}

function recordTitle(record) {
  return `${String(record.type ?? "record").toUpperCase()} ${record.id ?? "(no id)"}`;
}

function formatReceipt(record) {
  const lines = [recordTitle(record)];
  if (record.type === "landing") {
    lines.push(
      `  landing     ${short(record.landingCommit ?? record.attachedTo)}`,
      `  source      ${record.sourceRef ?? "-"} @ ${short(record.sourceHead)}`,
      `  mode        ${record.mode ?? "-"}`,
      `  absorbed    ${(record.absorbedChanges ?? []).length} changes in ${(record.absorbedCommits ?? []).length} commits`,
    );
  } else if (record.type === "application") {
    lines.push(
      `  applied     ${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}`,
      `  change      ${record.appliedChangeId ?? record.originChangeId ?? "-"}`,
      `  relation    ${record.relation ?? "-"}`,
    );
  } else if (record.type === "reconciliation") {
    const equality = record.exactStateEqualityAfter ?? record.exactStateEquality;
    lines.push(
      `  result      ${short(record.resultCommit ?? record.attachedTo)}`,
      `  source      ${record.sourceRef ?? "-"} @ ${short(record.sourceHead)}`,
      `  covered     ${(record.absorbedChanges ?? []).length} changes; ${(record.applied ?? []).length} applied now`,
      `  same state  ${equality === undefined ? "not recorded" : equality ? "yes" : "no"}`,
    );
  } else {
    lines.push(`  attached    ${short(record.attachedTo)}`);
  }
  if (record.createdAt) lines.push(`  created     ${record.createdAt}`);
  return lines.join("\n");
}

function formatReceipts(records) {
  if (records.length === 0) return "No causal records found.";
  return `${records.length} causal record${records.length === 1 ? "" : "s"}\n\n${records
    .map(formatReceipt)
    .join("\n\n")}`;
}

function formatCausalEdges(records) {
  const lines = [];
  for (const record of records) {
    if (record.type === "landing") {
      lines.push(
        `${short(record.landingCommit ?? record.attachedTo)} <= ${short(record.sourceHead)}  ${record.mode}; ${(record.absorbedChanges ?? []).length} changes absorbed`,
      );
    } else if (record.type === "application") {
      lines.push(
        `${short(record.appliedCommit ?? record.attachedTo)} <= ${short(record.originCommit)}  apply ${record.appliedChangeId ?? record.originChangeId ?? "unknown"}`,
      );
    } else if (record.type === "reconciliation") {
      lines.push(
        `${short(record.resultCommit ?? record.attachedTo)} <= ${short(record.sourceHead)}  reconcile; ${(record.absorbedChanges ?? []).length} covered, ${(record.applied ?? []).length} applied`,
      );
    }
  }
  if (lines.length === 0) return "  (none)";
  return lines.map((line) => `  ${line}`).join("\n");
}

export async function main(rawArgs) {
  const [command, ...rest] = rawArgs;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  const { positionals, options } = parseArgs(rest);
  switch (command) {
    case "init": {
      const context = initLab();
      print(`Initialized vcs-lab metadata in ${context.root}`);
      return;
    }
    case "commit": {
      const message = requireValue(options.message, "vlab commit -m <message>");
      const result = createCommit(message, {
        all: options.all,
        allowEmpty: options.allowEmpty,
      });
      print(result, options.json);
      return;
    }
    case "branch": {
      const name = requireValue(positionals[0], "vlab branch <name> [from]");
      const from = positionals[1] ?? "HEAD";
      runGit(["switch", "-c", name, from]);
      print(`Created and switched to ${name} from ${from}`);
      return;
    }
    case "merge":
    case "compact-merge":
    case "hard-squash": {
      const source = requireValue(positionals[0], `vlab ${command} <source>`);
      let mode = command === "hard-squash" || options.hardSquash ? "hard-squash" : "compact";
      if (options.compact) mode = "compact";
      const receipt = land(source, mode, { message: options.message });
      print(receipt, options.json);
      return;
    }
    case "merge-plan": {
      const source = requireValue(positionals[0], "vlab merge-plan <source>");
      const plan = buildMergePlan(source);
      print(options.json ? plan : formatMergePlan(plan), options.json);
      return;
    }
    case "reconcile": {
      const source = requireValue(positionals[0], "vlab reconcile <source>");
      const result = reconcile(source, { acceptCandidates: options.acceptCandidates });
      print(result, options.json);
      return;
    }
    case "cherry-pick": {
      const value = requireValue(positionals[0], "vlab cherry-pick <commit-or-change-id>");
      const result = cherryPick(value, { fork: options.fork, repeat: options.repeat });
      print(result, options.json);
      return;
    }
    case "graph": {
      const graph = runGit([
        "log",
        "--graph",
        "--oneline",
        "--decorate",
        "--branches",
        "--tags",
        "--remotes",
        "HEAD",
      ]).stdout;
      const records = listNoteRecords();
      print(`Project history\n${graph}\n\nCausal edges\n${formatCausalEdges(records)}`);
      return;
    }
    case "receipts": {
      const records = listNoteRecords();
      print(options.json ? records : formatReceipts(records), options.json);
      return;
    }
    case "workspace": {
      const subcommand = positionals[0];
      if (subcommand === "create") {
        const name = requireValue(positionals[1], "vlab workspace create <name>");
        const workspace = createWorkspace(name, options);
        print(workspace, options.json);
        return;
      }
      if (subcommand === "list") {
        print(listWorkspaces(), true);
        return;
      }
      if (subcommand === "checkpoint") {
        const checkpoint = checkpointWorkspace(options.label);
        print(checkpoint, options.json);
        return;
      }
      throw new CliError("Unknown workspace command. Use create, list, or checkpoint.");
    }
    case "spec": {
      const subcommand = positionals[0];
      const file = requireValue(positionals[1], `vlab spec ${subcommand ?? "index"} <file>`);
      if (subcommand === "index") {
        const result = indexSpec(file);
        print(options.json ? result : formatSpecResult(result), options.json);
        return;
      }
      if (subcommand === "show") {
        print(readSpecManifest(file), true);
        return;
      }
      throw new CliError("Unknown spec command. Use index or show.");
    }
    case "doctor": {
      const git = runGit(["--version"]); 
      const context = initLab();
      print({
        ok: true,
        git: git.stdout,
        node: process.version,
        repository: context.root,
        notesRef: "refs/notes/vcs-lab",
      }, true);
      return;
    }
    default:
      throw new CliError(`Unknown command '${command}'.\n\n${HELP}`);
  }
}
