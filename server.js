const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Readable } = require("stream");

const PORT = Number(process.env.PORT || 3111);
const PUBLIC_DIR = path.join(__dirname, "public");
const KATEX_DIST_DIR = path.join(__dirname, "node_modules", "katex", "dist");
const DEFAULT_LOG_FILE = path.join(__dirname, "hypermania.log");

function configuredLogFile(value)
{
  if (value === undefined) return DEFAULT_LOG_FILE;

  // Requiring an absolute path keeps service and test logs independent of the
  // process working directory, which can vary across launchers and test runs.
  if (!value || !path.isAbsolute(value) || value.includes("\0"))
  {
    throw new Error("HYPERMANIA_LOG_FILE must be an absolute file path.");
  }
  return path.normalize(value);
}

const LOG_FILE = configuredLogFile(process.env.HYPERMANIA_LOG_FILE);
const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 32;
const MAX_RENDERED_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 512 * 1024;
const MAX_PDF_TEXT_PER_PAGE_CHARS = 64 * 1024;
const MAX_PDF_TEXT_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_CHAT_JOBS = 50;
const MAX_CHAT_JOB_CHARS = 8 * 1024 * 1024;
const MAX_CHAT_JOB_RUNTIME_MS = 30 * 60 * 1000;
const CHAT_JOB_RETENTION_MS = 6 * 60 * 60 * 1000;
const TRACE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// The JSON request contains base64, which expands the allowed PDF before validation.
const MAX_PDF_REQUEST_BYTES = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 1024 * 1024;
const chatJobs = new Map();

const OLLAMA_TELEMETRY_FIELDS = {
  total_duration: "totalDurationNs",
  load_duration: "loadDurationNs",
  prompt_eval_count: "promptEvalCount",
  prompt_eval_cached_count: "promptEvalCachedCount",
  prompt_eval_duration: "promptEvalDurationNs",
  eval_count: "evalCount",
  eval_duration: "evalDurationNs",
};

class PdfInputError extends Error { }

function configuredPdfToolRunner(value)
{
  if (value === undefined) return undefined;
  if (!value || !path.isAbsolute(value) || value.includes("\0"))
  {
    throw new Error("HYPERMANIA_PDF_TOOL_RUNNER must be an absolute file path.");
  }
  return path.normalize(value);
}

const PDF_TOOL_RUNNER = configuredPdfToolRunner(process.env.HYPERMANIA_PDF_TOOL_RUNNER);

function runPdfTool(tool, args, options)
{
  if (!PDF_TOOL_RUNNER) return execFileAsync(tool, args, options);
  return execFileAsync(process.execPath, [PDF_TOOL_RUNNER, tool, ...args], options);
}

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

async function appendLogSafely(entry)
{
  try
  {
    await appendLog(entry);
  } catch (error)
  {
    // Logging is best-effort so an unavailable log file cannot replace the
    // response for the failure that operators actually need to diagnose.
    console.error(safeStringify({
      source: "logging",
      event: "write_failed",
      message: error.message || "Could not write the Hypermania log.",
      originalEntry: entry,
    }));
  }
}

function getTraceContext(req)
{
  if (req.traceContext) return req.traceContext;
  const threadHeader = String(req.headers["x-hypermania-thread-id"] || "");
  const requestHeader = String(req.headers["x-hypermania-request-id"] || "");
  // IDs are untrusted input used in logs, so accept only canonical UUIDs and
  // create a safe request reference when a caller omits or spoofs one.
  req.traceContext = {
    threadId: TRACE_ID_PATTERN.test(threadHeader) ? threadHeader : undefined,
    requestId: TRACE_ID_PATTERN.test(requestHeader) ? requestHeader : randomUUID(),
  };
  return req.traceContext;
}

function boundedDiagnostic(value)
{
  // Bound upstream diagnostics and remove control characters to keep every
  // structured log event single-line and resistant to log injection.
  return String(value || "Unknown failure").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 2000);
}

function errorDiagnostic(error)
{
  const cause = error?.cause;
  const errorFields = error && typeof error === "object"
    ? [error.name, error.code, error.errno, error.syscall, error.address, error.port, error.message]
    : [];
  const causeFields = cause && typeof cause === "object"
    ? [cause.name, cause.code, cause.errno, cause.syscall, cause.address, cause.port, cause.message]
    : [];
  // Node's fetch errors often expose only "fetch failed" at the top level;
  // the nested cause contains the actionable timeout, socket, or address data.
  return boundedDiagnostic([
    ...errorFields,
    ...causeFields,
  ].filter((value, index, values) => value !== undefined && value !== "" && values.indexOf(value) === index).join(" | "));
}

function ollamaResponse(response)
{
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    headers: {
      get(name)
      {
        const value = response.headers[String(name).toLowerCase()];
        return Array.isArray(value) ? value.join(", ") : value || null;
      },
    },
    body: Readable.toWeb(response),
    async text()
    {
      const chunks = [];
      let retainedBytes = 0;
      for await (const chunk of response)
      {
        if (retainedBytes >= 64 * 1024) continue;
        const remaining = 64 * 1024 - retainedBytes;
        const retained = Buffer.from(chunk).subarray(0, remaining);
        chunks.push(retained);
        retainedBytes += retained.length;
      }
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

function requestOllama(targetPath, body, signal)
{
  const target = new URL(targetPath, ollamaBase);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) =>
  {
    let activeResponse;
    const request = transport.request(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
      },
    });
    const abort = () =>
    {
      const error = new Error("The model request was aborted.");
      error.name = "AbortError";
      if (activeResponse) activeResponse.destroy(error);
      else request.destroy(error);
    };

    request.once("response", (response) =>
    {
      activeResponse = response;
      response.once("close", () => signal?.removeEventListener("abort", abort));
      resolve(ollamaResponse(response));
    });
    request.once("error", (error) =>
    {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal)
    {
      if (signal.aborted)
      {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    request.end(body);
  });
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

function sendError(res, status, error, requestId)
{
  sendJson(res, status, { error, requestId });
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
  const katexPrefix = "/vendor/katex/";
  const root = urlPath.startsWith(katexPrefix) ? KATEX_DIST_DIR : PUBLIC_DIR;
  const relativePath = urlPath.startsWith(katexPrefix) ? urlPath.slice(katexPrefix.length) : urlPath;
  const filePath = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`))
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
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Content-Length": data.length,
      // Revalidate deployed assets so an ordinary reload cannot keep an old
      // client error contract while the server is already running new code.
      "Cache-Control": "no-cache",
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
  const trace = getTraceContext(req);
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

  // Apply trusted fields last so client JSON cannot spoof another request or
  // impersonate a server-side log source.
  await appendLogSafely({ ...payload, source: "client", ...trace });

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
    const { stdout } = await runPdfTool("pdfinfo", [pdfPath], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const match = stdout.match(/^Pages:\s+(\d+)\s*$/m);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch (error)
  {
    if (error.code === "ENOENT")
    {
      throw new PdfInputError("PDF support requires Poppler. Install Poppler so pdfinfo, pdftotext, and pdftoppm are available on the server.");
    }
    throw new PdfInputError("Could not inspect this PDF. It may be corrupted or password-protected.");
  }
}

function pageAlignedPdfText(stdout, pageCount)
{
  const extracted = String(stdout || "").replace(/\r\n?/g, "\n").split("\f");
  let remainingChars = MAX_PDF_TEXT_CHARS;

  return Array.from({ length: pageCount }, (_, index) =>
  {
    const text = (extracted[index] || "").trim();
    const retainedChars = Math.min(text.length, MAX_PDF_TEXT_PER_PAGE_CHARS, remainingChars);
    const retainedText = text.slice(0, retainedChars);
    remainingChars -= retainedText.length;
    return {
      pageNumber: index + 1,
      imageIndex: index,
      text: retainedText,
      textTruncated: retainedText.length < text.length,
    };
  });
}

async function extractPdfText(pdfPath, pageCount)
{
  try
  {
    const { stdout } = await runPdfTool(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", pdfPath, "-"],
      {
        timeout: 30000,
        maxBuffer: MAX_PDF_TEXT_BUFFER_BYTES,
        windowsHide: true,
      }
    );
    return pageAlignedPdfText(stdout, pageCount);
  } catch (error)
  {
    if (error.code === "ENOENT")
    {
      throw new PdfInputError("PDF support requires Poppler. Install Poppler so pdfinfo, pdftotext, and pdftoppm are available on the server.");
    }

    // Text is an optimization rather than a rendering prerequisite. Scans and
    // PDFs with unusual encodings still remain usable through their page images.
    return pageAlignedPdfText("", pageCount);
  }
}

async function handlePdfRender(req, res)
{
  const trace = getTraceContext(req);
  if (req.method !== "POST")
  {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let tempDir;
  let attachmentIndex;
  let attachmentCount;
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
    attachmentIndex = Number.isInteger(payload.attachmentIndex) && payload.attachmentIndex > 0
      ? payload.attachmentIndex
      : undefined;
    attachmentCount = Number.isInteger(payload.attachmentCount) && payload.attachmentCount > 0
      ? payload.attachmentCount
      : undefined;
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

    const pages = await extractPdfText(inputPath, pageCount);

    try
    {
      await runPdfTool("pdftoppm", ["-png", "-r", "150", inputPath, outputPrefix], {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    } catch (error)
    {
      if (error.code === "ENOENT")
      {
        throw new PdfInputError("PDF support requires Poppler. Install Poppler so pdfinfo, pdftotext, and pdftoppm are available on the server.");
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

    await appendLogSafely({
      source: "pdf",
      event: "rendered",
      ...trace,
      attachmentIndex,
      attachmentCount,
      pages: pageCount,
      inputBytes: pdf.length,
      outputBytes: totalBytes,
      textPages: pages.filter((page) => page.text).length,
      textChars: pages.reduce((total, page) => total + page.text.length, 0),
      textTruncated: pages.some((page) => page.textTruncated),
    });
    sendJson(res, 200, { images, pageCount, pages });
  } catch (error)
  {
    const expected = error instanceof PdfInputError || error.statusCode === 413;
    await appendLogSafely({
      source: "pdf",
      event: "render_failed",
      ...trace,
      attachmentIndex,
      attachmentCount,
      status: expected ? error.statusCode || 400 : 500,
      message: boundedDiagnostic(error.message),
    });
    sendError(
      res,
      expected ? error.statusCode || 400 : 500,
      expected ? error.message : "PDF rendering failed. Check the server log and try again.",
      trace.requestId
    );
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
  const trace = getTraceContext(req);
  const body = await readBody(req);
  await appendLogSafely({
    source: "proxy",
    event: "request_start",
    ...trace,
    targetPath,
    method: req.method,
    bytes: body.length,
  });

  const response = await requestOllama(targetPath, body);

  if (!response.ok)
  {
    const details = await response.text();
    await appendLogSafely({
      source: "proxy",
      event: "request_failed",
      ...trace,
      targetPath,
      status: response.status,
      message: boundedDiagnostic(details || `Ollama returned HTTP ${response.status}.`),
    });
    sendError(
      res,
      response.status,
      targetPath === "/api/chat" ? "The model request failed." : "The Ollama request failed.",
      trace.requestId
    );
    return;
  }

  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  if (!response.body)
  {
    await appendLogSafely({
      source: "proxy",
      event: "response_empty_body",
      ...trace,
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
    await appendLogSafely({
      source: "proxy",
      event: "request_end",
      ...trace,
      targetPath,
      status: response.status,
      bytes: total,
    });
  }
}

function pruneChatJobs(reserveSlot = false)
{
  const cutoff = Date.now() - CHAT_JOB_RETENTION_MS;
  for (const [id, job] of chatJobs)
  {
    if (job.status !== "running" && job.updatedAt < cutoff)
    {
      chatJobs.delete(id);
    }
  }

  if (reserveSlot && chatJobs.size >= MAX_CHAT_JOBS)
  {
    // Prefer evicting the oldest terminal response over rejecting a new chat.
    // Running jobs are never evicted because that would strand their clients.
    const completed = [...chatJobs.values()]
      .filter((job) => job.status !== "running")
      .sort((left, right) => left.updatedAt - right.updatedAt);
    while (chatJobs.size >= MAX_CHAT_JOBS && completed.length)
    {
      chatJobs.delete(completed.shift().id);
    }
  }
}

function appendChatJobData(job, text)
{
  if (!text) return;
  if (job.data.length + text.length > MAX_CHAT_JOB_CHARS)
  {
    throw new Error("The model response exceeded the recoverable response limit.");
  }
  // Offsets use JavaScript string positions end-to-end. This keeps UTF-8 chunks
  // safe even when Ollama splits a multibyte character across network reads.
  job.data += text;
  job.updatedAt = Date.now();
}

function observeOllamaTelemetry(job, text, flush = false)
{
  // Ollama may split an NDJSON object across arbitrary transport chunks. Keep
  // only an incomplete line here; completed response text remains in job.data.
  job.telemetryBuffer += text;
  const lines = job.telemetryBuffer.split("\n");
  job.telemetryBuffer = flush ? "" : lines.pop();
  if (flush && lines.at(-1) === "") lines.pop();

  for (const line of lines)
  {
    if (!line.trim()) continue;
    let payload;
    try
    {
      payload = JSON.parse(line);
    } catch
    {
      continue;
    }
    if (payload?.done !== true) continue;

    // Model output, prompts, images, filenames, and context are deliberately
    // excluded. Only bounded numeric performance counters may reach the log.
    for (const [source, target] of Object.entries(OLLAMA_TELEMETRY_FIELDS))
    {
      const value = payload[source];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      {
        job.telemetry[target] = value;
      }
    }
  }
}

async function runChatJob(job, body)
{
  // Mobile browsers may suspend or discard their response connection. Owning
  // the Ollama stream here lets clients reconnect without starting a second
  // generation or losing chunks produced while the tab was in the background.
  let reader;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_CHAT_JOB_RUNTIME_MS);
  try
  {
    const response = await requestOllama("/api/chat", body, controller.signal);

    if (!response.ok)
    {
      const details = await response.text();
      throw new Error(details || `Ollama returned HTTP ${response.status}.`);
    }
    if (!response.body)
    {
      throw new Error("Ollama returned an empty response.");
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true)
    {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      appendChatJobData(job, text);
      observeOllamaTelemetry(job, text);
    }
    const trailing = decoder.decode();
    appendChatJobData(job, trailing);
    observeOllamaTelemetry(job, trailing, true);
    job.status = "complete";
  } catch (error)
  {
    job.status = "failed";
    job.error = error.name === "AbortError"
      ? "The model request exceeded the 30-minute response limit."
      : "The model request failed. Check the server log and try again.";
    job.errorDetails = errorDiagnostic(error);
    if (reader) await reader.cancel().catch(() => { });
  } finally
  {
    clearTimeout(timeout);
    if (reader) reader.releaseLock();
    job.updatedAt = Date.now();
    await appendLogSafely({
      source: "chat_job",
      event: "finished",
      threadId: job.threadId,
      requestId: job.requestId,
      jobId: job.id,
      status: job.status,
      chars: job.data.length,
      ...job.telemetry,
      error: job.errorDetails || undefined,
    });
  }
}

async function handleChatJobs(req, res)
{
  const trace = getTraceContext(req);
  const requestUrl = new URL(req.url, "http://localhost");
  pruneChatJobs(req.method === "POST" && requestUrl.pathname === "/api/chat/jobs");

  if (requestUrl.pathname === "/api/chat/jobs")
  {
    if (req.method !== "POST")
    {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (chatJobs.size >= MAX_CHAT_JOBS)
    {
      await appendLogSafely({ source: "chat_job", event: "rejected", ...trace, status: 503, reason: "capacity" });
      sendError(res, 503, "Too many responses are being retained. Try again later.", trace.requestId);
      return;
    }

    const body = await readBody(req);
    let payload;
    try
    {
      payload = JSON.parse(body.toString("utf8"));
    } catch
    {
      await appendLogSafely({ source: "chat_job", event: "rejected", ...trace, status: 400, reason: "invalid_json" });
      sendError(res, 400, "Invalid chat request.", trace.requestId);
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
    {
      await appendLogSafely({ source: "chat_job", event: "rejected", ...trace, status: 400, reason: "invalid_payload" });
      sendError(res, 400, "Invalid chat request.", trace.requestId);
      return;
    }

    payload.stream = true;
    const job = {
      id: randomUUID(),
      ...trace,
      status: "running",
      data: "",
      error: "",
      telemetry: {},
      telemetryBuffer: "",
      updatedAt: Date.now(),
    };
    chatJobs.set(job.id, job);
    await appendLogSafely({ source: "chat_job", event: "started", ...trace, jobId: job.id });
    sendJson(res, 202, { id: job.id, requestId: trace.requestId });
    runChatJob(job, Buffer.from(JSON.stringify(payload))).catch(() => { });
    return;
  }

  const match = requestUrl.pathname.match(/^\/api\/chat\/jobs\/([a-f0-9-]{36})$/i);
  if (!match)
  {
    sendJson(res, 404, { error: "Chat response not found." });
    return;
  }
  if (req.method !== "GET")
  {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const job = chatJobs.get(match[1]);
  if (!job)
  {
    sendJson(res, 404, { error: "This response is no longer available." });
    return;
  }

  const offset = Number(requestUrl.searchParams.get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > job.data.length)
  {
    sendJson(res, 416, { error: "Invalid response offset." });
    return;
  }

  sendJson(res, 200, {
    status: job.status,
    offset: job.data.length,
    data: job.data.slice(offset),
    requestId: job.requestId,
    ...(job.error ? { error: job.error } : {}),
  });
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
    await appendLogSafely({ source: "config", event: "ollama_base_changed", ollamaBase });
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
      "Access-Control-Allow-Headers": "Content-Type, X-Hypermania-Thread-Id, X-Hypermania-Request-Id",
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

    if (req.url.startsWith("/api/chat/jobs"))
    {
      await handleChatJobs(req, res);
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
    const trace = getTraceContext(req);
    await appendLogSafely({
      source: "server",
      event: "request_failed",
      ...trace,
      method: req.method,
      path: req.url.split("?")[0],
      message: errorDiagnostic(error),
    });
    sendError(res, 500, "Unexpected server error. Check the server log and try again.", trace.requestId);
  }
});

server.listen(PORT, () =>
{
  console.log(`Hypermania running at http://localhost:${PORT}`);
  console.log(`Proxying Ollama API at ${ollamaBase}`);
  console.log(`Writing debug log to ${LOG_FILE}`);
});
