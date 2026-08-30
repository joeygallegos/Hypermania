const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const LOG_FILE = path.join(__dirname, "hypermania.log");

function normalizeOllamaBase(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("Ollama instance must be a complete HTTP(S) URL.");
  }

  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Ollama instance must use http:// or https:// and include a hostname or IP address.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Ollama instance must be a base URL without credentials, paths, queries, or fragments.");
  }
  return url.origin;
}

let ollamaBase = normalizeOllamaBase(process.env.OLLAMA_BASE || "http://127.0.0.1:11434");

function stamp() {
  return new Date().toISOString();
}

function safeStringify(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ error: "Unserializable payload" });
  }
}

async function appendLog(entry) {
  const line = `${stamp()} ${safeStringify(entry)}\n`;
  await fs.promises.appendFile(LOG_FILE, line, "utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleLog(req, res) {
  const body = await readBody(req);
  let payload = {};
  try {
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch (error) {
    payload = {
      level: "error",
      event: "client_log_parse_error",
      message: error.message,
      rawLength: body.length,
    };
  }

  await appendLog({
    source: "client",
    ...payload,
  });

  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
  });
  res.end();
}

async function proxy(req, res, targetPath) {
  const body = await readBody(req);
  await appendLog({
    source: "proxy",
    event: "request_start",
    targetPath,
    method: req.method,
    bytes: body.length,
  });

  const response = await fetch(`${ollamaBase}${targetPath}`, {
    method: "POST",
    headers: {
      "Content-Type": req.headers["content-type"] || "application/json",
    },
    body,
  });

  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  if (!response.body) {
    await appendLog({
      source: "proxy",
      event: "response_empty_body",
      targetPath,
      status: response.status,
    });
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      res.write(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
    res.end();
    await appendLog({
      source: "proxy",
      event: "request_end",
      targetPath,
      status: response.status,
      bytes: total,
    });
  }
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function handleOllamaConfig(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { ollamaBase });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: "Changing the Ollama instance is allowed only from the local machine." });
    return;
  }

  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON configuration." });
    return;
  }

  try {
    ollamaBase = normalizeOllamaBase(payload?.ollamaBase);
    await appendLog({ source: "config", event: "ollama_base_changed", ollamaBase });
    sendJson(res, 200, { ollamaBase });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Invalid Ollama instance." });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (req.url.startsWith("/api/ollama/config")) {
      await handleOllamaConfig(req, res);
      return;
    }

    if (req.url.startsWith("/api/ollama/tags")) {
      const response = await fetch(`${ollamaBase}/api/tags`);
      const data = await response.json();
      sendJson(res, response.status, data);
      return;
    }

    if (req.url.startsWith("/api/ollama/show")) {
      await proxy(req, res, "/api/show");
      return;
    }

    if (req.url.startsWith("/api/log")) {
      await handleLog(req, res);
      return;
    }

    if (req.url.startsWith("/api/chat")) {
      await proxy(req, res, "/api/chat");
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Unexpected server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Hypermania running at http://localhost:${PORT}`);
  console.log(`Proxying Ollama API at ${ollamaBase}`);
  console.log(`Writing debug log to ${LOG_FILE}`);
});
