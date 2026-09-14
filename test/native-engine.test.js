import { testEnv } from "../test-support/git-environment.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as engine from "../src/engine.js";
import * as git from "../src/git.js";
import { loadNativeEngine } from "../src/native-engine.js";

Object.assign(process.env, testEnv());
// The supported profile deliberately excludes command-scope configuration.
delete process.env.GIT_CONFIG_COUNT;
const available = engine.nativeEngine().available;
if (process.env.VLAB_REQUIRE_NATIVE === "1") assert.equal(available, true, "native prebuild required");

function fixture(t, options = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vlab-native-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: testEnv() });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  run("init", "-q", "-b", "main", ...options);
  run("config", "user.name", "Native Test");
  run("config", "user.email", "native@example.invalid");
  fs.writeFileSync(path.join(root, "result"), "retained result\n");
  run("add", ".");
  run("commit", "-qm", "base");
  const head = run("rev-parse", "HEAD");
  run("update-ref", "refs/vcs-lab/resolutions/a", head);
  run("notes", "--ref=vcs-lab", "add", "-m", "note", head);
  return { root, run, head };
}

function compare(operation, args, native = true) {
  const expected = git.withReadEngine("git", () => git[operation](...args));
  const collector = git.beginGitMetrics(operation);
  let actual;
  let metrics;
  git.withReadEngine("native", () => {
    actual = engine[operation](...args);
    metrics = git.endGitMetrics(collector);
  });
  assert.deepEqual(actual, expected, operation);
  if (native) {
    assert.equal(metrics.processes, 0, JSON.stringify(metrics));
    assert.deepEqual(metrics.fallbacks, []);
    assert.equal(metrics.nativeReads[operation], 1);
  } else {
    assert.ok(metrics.fallbacks.length > 0, JSON.stringify(metrics));
    assert.deepEqual(metrics.nativeReads, {});
  }
}

test("native reads match Git for loose and packed objects, refs, notes, and linked worktrees", { skip: !available }, (t) => {
  const { root, run, head } = fixture(t);
  const linked = path.join(root, "linked");
  run("worktree", "add", "--detach", linked, head);
  run("tag", "-a", "tag", "-m", "tag");
  const tag = run("rev-parse", "tag");
  const expressions = [head, `${head}^{commit}`, `${head}^{tree}`, `${head}:result`, `${tag}^{commit}`, "0".repeat(40)];
  for (const packed of [false, true]) {
    if (packed) { run("pack-refs", "--all"); run("gc", "--quiet"); }
    const before = [run("for-each-ref", "--format=%(refname) %(objectname)"),
      run("status", "--porcelain"), run("worktree", "list", "--porcelain")];
    for (const cwd of [root, linked]) {
      compare("repoContext", [cwd]);
      compare("listRefs", ["refs/vcs-lab/resolutions", cwd]);
      compare("inspectGitObjects", [expressions, cwd]);
      compare("readGitObjects", [expressions, cwd]);
      compare("listNoteEntries", ["vcs-lab", cwd]);
    }
    assert.deepEqual([run("for-each-ref", "--format=%(refname) %(objectname)"),
      run("status", "--porcelain"), run("worktree", "list", "--porcelain")], before);
  }
  run("update-ref", "refs/vcs-lab/resolutions/b", tag);
  run("update-ref", "-d", "refs/vcs-lab/resolutions/a");
  compare("listRefs", ["refs/vcs-lab/resolutions", root]);
  run("fsck", "--no-dangling");
});

test("unsupported expressions and repository profiles fall back as complete operations", { skip: !available }, (t) => {
  const { root, head } = fixture(t);
  compare("readGitObjects", [[head, "HEAD~0"], root], false);
  compare("listRefs", ["refs/heads/*", root], false);
  const sha256 = fixture(t, ["--object-format=sha256"]);
  compare("repoContext", [sha256.root], false);
  compare("listNoteEntries", ["vcs-lab", sha256.root], false);
  const reftable = fixture(t, ["--ref-format=reftable"]);
  compare("listRefs", ["refs/heads", reftable.root], false);
});

function rawObject(root, type, data) {
  const result = spawnSync("git", ["hash-object", "-w", "--literally", "-t", type, "--stdin"], {
    cwd: root, input: data, env: testEnv(),
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString().trim();
}

test("native notes reject duplicate, malformed, and oversized trees without partial results", { skip: !available }, (t) => {
  const { root, run, head } = fixture(t);
  const note = rawObject(root, "blob", Buffer.from("duplicate\n"));
  const entry = (name) => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(note, "hex")]);
  const duplicate = rawObject(root, "tree", Buffer.concat([entry(head.toUpperCase()), entry(head)]));
  run("update-ref", "refs/notes/vcs-lab", duplicate);
  compare("listNoteEntries", ["vcs-lab", root], false);
  const malformed = rawObject(root, "tree", Buffer.from("100644 truncated\0x"));
  run("update-ref", "refs/notes/vcs-lab", malformed);
  compare("listNoteEntries", ["vcs-lab", root], false);
  const oversized = rawObject(root, "blob", Buffer.alloc(64 * 1024 * 1024 + 1, 97));
  compare("inspectGitObjects", [[oversized], root]);
  compare("readGitObjects", [[head, oversized], root], false);
});

test("missing and broken optional bindings preserve Git functionality", (t) => {
  assert.equal(loadNativeEngine(() => { throw new Error("invalid binary"); }).reason, "binding-load-error");
  const { root } = fixture(t);
  const moduleUrl = new URL("../src/engine.js", import.meta.url).href;
  const script = `import { describeReadEngines, repoContext } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify({ engine: describeReadEngines(), context: repoContext() }));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root, encoding: "utf8", env: testEnv({ VLAB_ENGINE: "native", VLAB_TEST_NATIVE_BINDING: "missing" }),
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.engine.native.available, false);
  assert.equal(parsed.engine.native.reason, "binding-missing");
  assert.equal(parsed.context.root, root);
});
