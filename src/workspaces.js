import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentHead,
  gitText,
  refExists,
  repoContext,
  resolveRevision,
  runGit,
} from "./git.js";
import { newId, slug } from "./ids.js";
import { ensureLabRuntime, readJson, writeJson } from "./store.js";
import { CliError } from "./errors.js";

function workspaceFile(cwd) {
  return path.join(ensureLabRuntime(cwd), "workspaces.json");
}

export function readWorkspaces(cwd = process.cwd()) {
  return readJson(workspaceFile(cwd), {
    schema: "vcs-lab.workspaces/v1",
    workspaces: [],
  });
}

function saveWorkspaces(value, cwd) {
  writeJson(workspaceFile(cwd), value);
}

export function createWorkspace(name, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const context = repoContext(cwd);
  const target = options.from ?? "HEAD";
  const baseSnapshot = resolveRevision(target, cwd);
  const safeName = slug(name);
  const state = readWorkspaces(cwd);
  if (state.workspaces.some((workspace) => workspace.name === name)) {
    throw new CliError(`Workspace '${name}' already exists.`);
  }

  const parent = path.dirname(context.root);
  const repoName = path.basename(context.root);
  const workspacePath = path.resolve(
    options.path ?? path.join(parent, `${repoName}.workspaces`, safeName),
  );
  const branch = `vlab/ws/${safeName}`;
  if (refExists(`refs/heads/${branch}`, cwd)) {
    throw new CliError(`The compatibility branch '${branch}' already exists.`);
  }
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  runGit(["worktree", "add", "-b", branch, workspacePath, baseSnapshot], {
    cwd: context.root,
  });

  const workspace = {
    schema: "vcs-lab.workspace/v1",
    id: newId("ws"),
    name,
    path: workspacePath,
    compatibilityBranch: branch,
    target,
    baseSnapshot,
    createdAt: new Date().toISOString(),
    owner: options.owner ?? null,
    focus: options.focus ?? null,
    lifecycle: "active",
  };
  state.workspaces.push(workspace);
  saveWorkspaces(state, cwd);
  return workspace;
}

export function listWorkspaces(cwd = process.cwd()) {
  const state = readWorkspaces(cwd);
  return state.workspaces.map((workspace) => {
    let status = "missing";
    let head = null;
    let dirtyFiles = null;
    if (fs.existsSync(workspace.path)) {
      const probe = runGit(["rev-parse", "--is-inside-work-tree"], {
        cwd: workspace.path,
        allowFailure: true,
      });
      if (probe.ok) {
        status = "active";
        head = currentHead(workspace.path);
        const porcelain = gitText(["status", "--porcelain=v1"], {
          cwd: workspace.path,
        });
        dirtyFiles = porcelain ? porcelain.split(/\r?\n/).length : 0;
      }
    }
    return { ...workspace, status, head, dirtyFiles };
  });
}

function currentWorkspace(cwd) {
  const context = repoContext(cwd);
  const state = readWorkspaces(cwd);
  const match = state.workspaces.find(
    (workspace) => path.resolve(workspace.path) === path.resolve(context.root),
  );
  if (match) return match;
  return {
    id: "main",
    name: path.basename(context.root),
    path: context.root,
    target: "HEAD",
    baseSnapshot: currentHead(cwd),
  };
}

export function checkpointWorkspace(label, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const context = repoContext(cwd);
  const workspace = currentWorkspace(cwd);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vlab-index-"));
  const indexPath = path.join(temporaryDirectory, "index");
  const env = { GIT_INDEX_FILE: indexPath };
  const ref = `refs/vcs-lab/checkpoints/${workspace.id}`;

  try {
    runGit(["read-tree", "HEAD"], { cwd: context.root, env });
    runGit(["add", "-A"], { cwd: context.root, env });
    const tree = gitText(["write-tree"], { cwd: context.root, env });
    const parent = refExists(ref, context.root)
      ? resolveRevision(ref, context.root)
      : currentHead(context.root);
    const message = [
      label || `Checkpoint ${workspace.name}`,
      "",
      `Workspace-Id: ${workspace.id}`,
      `Workspace-Base: ${currentHead(context.root)}`,
    ].join("\n");
    const checkpoint = gitText(
      ["commit-tree", tree, "-p", parent, "-F", "-"],
      { cwd: context.root, env, input: `${message}\n` },
    );
    runGit(["update-ref", ref, checkpoint], { cwd: context.root });
    return {
      schema: "vcs-lab.checkpoint/v1",
      id: checkpoint,
      shortId: checkpoint.slice(0, 12),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      tree,
      parent,
      ref,
      label: label || null,
      createdAt: new Date().toISOString(),
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
