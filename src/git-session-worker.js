import { spawn } from "node:child_process";
import { parentPort, workerData } from "node:worker_threads";

const git = spawn(workerData.gitCommand ?? "git", ["cat-file", "--batch-command"], {
  cwd: workerData.cwd,
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = Buffer.alloc(0);
let stderr = "";
let startupError = null;
const pending = [];

git.stderr.setEncoding("utf8");
git.stderr.on("data", (chunk) => {
  stderr += chunk;
  if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
});
git.on("error", (error) => {
  startupError = error;
  while (pending.length) pending.shift().reject(error);
});
git.on("exit", (code, signal) => {
  if (code === 0 || signal === "SIGTERM") return;
  const error = new Error(
    `git cat-file session exited with status ${code ?? signal}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
  );
  while (pending.length) pending.shift().reject(error);
});

function parseResponse() {
  while (pending.length) {
    const newline = stdout.indexOf(0x0a);
    if (newline < 0) return;
    const header = stdout.subarray(0, newline).toString("utf8");
    const request = pending[0];
    if (header.endsWith(" missing")) {
      stdout = stdout.subarray(newline + 1);
      pending.shift();
      request.resolve({
        expression: request.expression,
        exists: false,
        oid: null,
        type: null,
        size: 0,
        content: null,
      });
      continue;
    }
    const match = header.match(/^([0-9a-f]+) (\S+) (\d+)$/);
    if (!match) {
      pending.shift();
      request.reject(new Error(`Unexpected git cat-file session header: ${header}`));
      stdout = stdout.subarray(newline + 1);
      continue;
    }
    const size = Number(match[3]);
    if (request.command === "info") {
      stdout = stdout.subarray(newline + 1);
      pending.shift();
      request.resolve({
        expression: request.expression,
        exists: true,
        oid: match[1],
        type: match[2],
        size,
        content: null,
      });
      continue;
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (stdout.length <= contentEnd) return;
    if (stdout[contentEnd] !== 0x0a) {
      pending.shift();
      request.reject(new Error("Git returned malformed session object content."));
      stdout = stdout.subarray(contentEnd);
      continue;
    }
    const content = stdout.subarray(contentStart, contentEnd);
    stdout = stdout.subarray(contentEnd + 1);
    pending.shift();
    request.resolve({
      expression: request.expression,
      exists: true,
      oid: match[1],
      type: match[2],
      size,
      content: content.toString("base64"),
    });
  }
}

git.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
  parseResponse();
});

function query(command, expression) {
  if (startupError) return Promise.reject(startupError);
  return new Promise((resolve, reject) => {
    pending.push({ command, expression, resolve, reject });
    git.stdin.write(`${command} ${expression}\n`, "utf8", (error) => {
      if (!error) return;
      const index = pending.findIndex(
        (item) => item.command === command && item.expression === expression,
      );
      if (index >= 0) pending.splice(index, 1);
      reject(error);
    });
  });
}

function respond(shared, value) {
  const header = new Int32Array(shared, 0, 4);
  const payload = new Uint8Array(shared, 16);
  let encoded = Buffer.from(JSON.stringify(value), "utf8");
  if (encoded.length > payload.length) {
    encoded = Buffer.from(
      JSON.stringify({
        ok: false,
        error: "Git object-session response exceeded its shared buffer.",
        code: "response-too-large",
      }),
      "utf8",
    );
  }
  payload.set(encoded);
  Atomics.store(header, 1, encoded.length);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

parentPort.on("message", async (message) => {
  if (message.type === "close") {
    git.kill();
    respond(message.shared, { ok: true });
    process.exit(0);
  }
  try {
    const expressions = message.expressions.map(String);
    const results = await Promise.all(
      expressions.map((expression) => query(message.command, expression)),
    );
    respond(message.shared, { ok: true, results });
  } catch (error) {
    respond(message.shared, {
      ok: false,
      error: error?.message ?? String(error),
    });
  }
});
