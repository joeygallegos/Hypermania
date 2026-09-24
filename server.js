const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const PORT = Number(process.env.PORT || 3111);
const PUBLIC_DIR = path.join(__dirname, "public");
const LOG_FILE = path.join(__dirname, "hypermania.log");
const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 32;
const MAX_RENDERED_PDF_BYTES = 40 * 1024 * 1024;
// The JSON request contains base64, which expands the allowed PDF before validation.
const MAX_PDF_REQUEST_BYTES = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 1024 * 1024;

class PdfInputError extends Error { }

function normalizeOllamaBase(value)
{
  let url;
  try
  {
    url = new URL(String(value || ""));
  } catch
  {
    throw new Error("Ollama instance must be a complete HTTP(S) URL.");
  }

  if (!url.hostname || !["http:", "https:"].includes(url.protocol))
  {
    throw new Error("Ollama instance must use http:// or https:// and include a hostname or IP address.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
  {
    throw new Error("Ollama instance must be a base URL without credentials, paths, queries, or fragments.");
  }
  return url.origin;
}

let ollamaBase = normalizeOllamaBase(process.env.OLLAMA_BASE || "http://127.0.0.1:11434");

function stamp()
{
  return new Date().toISOString();
}

function safeStringify(payload)
{
  try
  {
    return JSON.stringify(payload);
  } catch
  {
    return JSON.stringify({ error: "Unserializable payload" });
  }
}

async function appendLog(entry)
{
  const line = `${stamp()} ${safeStringify(entry)}\n`;
  await fs.promises.appendFile(LOG_FILE, line, "utf8");
}

function sendJson(res, status, payload)
{
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8")
{
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res)
{
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR))
  {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) =>
  {
    if (err)
    {
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

async function readBody(req, maxBytes = Infinity)
{
  return new Promise((resolve, reject) =>
  {
    const chunks = [];
    let totalBytes = 0;
    const contentLength = Number(req.headers["content-length"]);
    req.on("error", reject);

    if (Number.isFinite(contentLength) && contentLength > maxBytes)
    {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      reject(error);
      req.resume();
      return;
    }

    req.on("data", (chunk) =>
    {
      totalBytes += chunk.length;
      if (totalBytes <= maxBytes) chunks.push(chunk);
    });
    req.on("end", () =>
    {
      if (totalBytes > maxBytes)
      {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function handleLog(req, res)
{
  const body = await readBody(req);
  let payload = {};
  try
  {
    payload = JSON.parse(body.toString("utf8") || "{}");
  } catch (error)
  {
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

function getPdfPayload(payload)
{
  if (typeof payload?.data !== "string")
  {
    throw new PdfInputError("PDF data is required.");
  }

  const base64 = payload.data.replace(/^data:application\/pdf;base64,/i, "").replace(/\s/g, "");
  if (!base64 || !/^[a-z0-9+/]*={0,2}$/i.test(base64))
  {
    throw new PdfInputError("The uploaded file is not valid base64 PDF data.");
  }

  const pdf = Buffer.from(base64, "base64");
  if (!pdf.length || pdf.length > MAX_PDF_BYTES)
  {
    throw new PdfInputError(`PDFs must be no larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  }
  if (pdf.subarray(0, 1024).indexOf(Buffer.from("%PDF-")) === -1)
  {
    throw new PdfInputError("The uploaded file is not a PDF.");
  }
  return pdf;
}

async function getPdfPageCount(pdfPath)
{
  try
  {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { timeout: 15000 });
    const match = stdout.match(/^Pages:\s+(\d+)\s*$/m);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch (error)
  {
    if (error.code === "ENOENT")
    {
      throw new PdfInputError("PDF support requires Poppler. Install Poppler so pdfinfo and pdftoppm are available on the server.");
    }
    throw new PdfInputError("Could not inspect this PDF. It may be corrupted or password-protected.");
  }
}

async function handlePdfRender(req, res)
{
  if (req.method !== "POST")
  {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let tempDir;
  try
  {
    const body = await readBody(req, MAX_PDF_REQUEST_BYTES);
    let payload;
    try
    {
      payload = JSON.parse(body.toString("utf8"));
    } catch
    {
      throw new PdfInputError("Invalid PDF upload request.");
    }
    const pdf = getPdfPayload(payload);
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hypermania-pdf-"));
    const inputPath = path.join(tempDir, "source.pdf");
    const outputPrefix = path.join(tempDir, "page");
    await fs.promises.writeFile(inputPath, pdf);

    const pageCount = await getPdfPageCount(inputPath);
    if (!pageCount) throw new PdfInputError("Could not determine the number of pages in this PDF.");
    if (pageCount > MAX_PDF_PAGES)
    {
      throw new PdfInputError(`PDFs are limited to ${MAX_PDF_PAGES} pages. Split this document into smaller files and try again.`);
    }

    try
    {
      await execFileAsync("pdftoppm", ["-png", "-r", "150", inputPath, outputPrefix], {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error)
    {
      if (error.code === "ENOENT")
      {
        throw new PdfInputError("PDF support requires Poppler. Install Poppler so pdfinfo and pdftoppm are available on the server.");
      }
      throw new PdfInputError("Could not render this PDF. It may be corrupted or password-protected.");
    }

    const pagePaths = (await fs.promises.readdir(tempDir))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]));
    if (pagePaths.length !== pageCount) throw new PdfInputError("PDF rendering did not produce every page.");

    const images = [];
    let totalBytes = 0;
    for (const pageName of pagePaths)
    {
      const image = await fs.promises.readFile(path.join(tempDir, pageName));
      totalBytes += image.length;
      if (totalBytes > MAX_RENDERED_PDF_BYTES)
      {
        throw new PdfInputError("The rendered PDF is too large to send to the model. Try a shorter or lower-detail document.");
      }
      images.push(image.toString("base64"));
    }

    await appendLog({ source: "pdf", event: "rendered", pages: pageCount, inputBytes: pdf.length, outputBytes: totalBytes });
    sendJson(res, 200, { images, pageCount });
  } catch (error)
  {
    const expected = error instanceof PdfInputError || error.statusCode === 413;
    await appendLog({ source: "pdf", event: "render_failed", status: expected ? error.statusCode || 400 : 500, message: error.message });
    sendJson(res, expected ? error.statusCode || 400 : 500, {
      error: expected ? error.message : "PDF rendering failed. Check the server log and try again.",
    });
  } finally
  {
    if (tempDir)
    {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
  }
}

async function proxy(req, res, targetPath)
{
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

  if (!response.body)
  {
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
  try
  {
    while (true)
    {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      res.write(Buffer.from(value));
    }
  } finally
  {
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

function isLoopbackRequest(req)
{
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function handleOllamaConfig(req, res)
{
  if (req.method === "GET")
  {
    sendJson(res, 200, { ollamaBase });
    return;
  }

  if (req.method !== "POST")
  {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!isLoopbackRequest(req))
  {
    sendJson(res, 403, { error: "Changing the Ollama instance is allowed only from the local machine." });
    return;
  }

  const body = await readBody(req);
  let payload;
  try
  {
    payload = JSON.parse(body.toString("utf8"));
  } catch
  {
    sendJson(res, 400, { error: "Invalid JSON configuration." });
    return;
  }

  try
  {
    ollamaBase = normalizeOllamaBase(payload?.ollamaBase);
    await appendLog({ source: "config", event: "ollama_base_changed", ollamaBase });
    sendJson(res, 200, { ollamaBase });
  } catch (error)
  {
    sendJson(res, 400, { error: error.message || "Invalid Ollama instance." });
  }
}

const server = http.createServer(async (req, res) =>
{
  if (req.method === "OPTIONS")
  {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try
  {
    if (req.url.startsWith("/api/ollama/config"))
    {
      await handleOllamaConfig(req, res);
      return;
    }

    if (req.url.startsWith("/api/ollama/tags"))
    {
      const response = await fetch(`${ollamaBase}/api/tags`);
      const data = await response.json();
      sendJson(res, response.status, data);
      return;
    }

    if (req.url.startsWith("/api/ollama/show"))
    {
      await proxy(req, res, "/api/show");
      return;
    }

    if (req.url.startsWith("/api/log"))
    {
      await handleLog(req, res);
      return;
    }

    if (req.url.startsWith("/api/pdf/render"))
    {
      await handlePdfRender(req, res);
      return;
    }

    if (req.url.startsWith("/api/chat"))
    {
      await proxy(req, res, "/api/chat");
      return;
    }

    serveStatic(req, res);
  } catch (error)
  {
    sendJson(res, 500, {
      error: error.message || "Unexpected server error",
    });
  }
});

server.listen(PORT, () =>
{
  console.log(`Hypermania running at http://localhost:${PORT}`);
  console.log(`Proxying Ollama API at ${ollamaBase}`);
  console.log(`Writing debug log to ${LOG_FILE}`);
});
