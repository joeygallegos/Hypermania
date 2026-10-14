const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const projectDirectory = __dirname;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function unusedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForOutput(child, expected, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}.\n${output}`)), timeoutMs);
    const inspect = (chunk) => {
      output += chunk;
      if (!output.includes(expected)) return;
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      resolve(output);
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Hypermania exited with code ${code}.\n${output}`));
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("HYPERMANIA_LOG_FILE writes diagnostics only to the configured absolute path", async () => {
  const testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hypermania-log-config-"));
  const logFile = path.join(testDirectory, "isolated.log");
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      HYPERMANIA_LOG_FILE: logFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForOutput(child, `Writing debug log to ${logFile}`);
    const requestId = "c2af8f2a-f24e-47b7-82cd-0ffbe61ac5f7";
    const response = await fetch(`http://127.0.0.1:${port}/api/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hypermania-Request-Id": requestId,
      },
      body: JSON.stringify({ event: "isolated_test_event" }),
    });
    assert.equal(response.status, 204);

    const entry = JSON.parse((await fs.promises.readFile(logFile, "utf8")).trim().split(" ").slice(1).join(" "));
    assert.equal(entry.source, "client");
    assert.equal(entry.event, "isolated_test_event");
    assert.equal(entry.requestId, requestId);
  } finally {
    await stop(child);
    await fs.promises.rm(testDirectory, { recursive: true, force: true });
  }
});

test("HYPERMANIA_LOG_FILE rejects ambiguous relative paths", async () => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      HYPERMANIA_LOG_FILE: "relative.log",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(output, /HYPERMANIA_LOG_FILE must be an absolute file path/);
});
