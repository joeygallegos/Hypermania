# Hypermania

A focused, local-first chat interface for [Ollama](https://ollama.com). Hypermania streams responses as they arrive, renders completed answers as Markdown, and supports image prompts with vision-capable models.

## Highlights

- Connect to a local or trusted-network Ollama instance.
- Stream chats live, with a model selector in chat and advanced behavior controls on a dedicated Settings page.
- Reopen, continue, review, and delete completed conversations from local chat history.
- Save reusable prompts with dated version history and copy them into chat.
- Attach images or PDFs, preview the resulting pages, and send them to compatible vision models. PDFs are rendered locally into PNG page images, while native page text is retained for efficient follow-up questions.
- Refresh installed models without restarting the UI.
- Run as a small Node.js service or install it with the included Linux systemd helper.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer.
- [Ollama](https://ollama.com/) installed and running.
- At least one local Ollama model. Use a vision model such as `qwen3-vl:8b` when you want to attach images.

## Quick start

```bash
git clone https://github.com/joeygallegos/Hypermania.git
cd Hypermania
npm install
npm start
```

Then open [http://localhost:3111](http://localhost:3111). By default, Hypermania connects to Ollama at `http://127.0.0.1:11434`.

> KaTeX is the sole production npm dependency and is served locally for math rendering. Sass is installed as a development dependency to compile the stylesheet before startup.

## Configuration

Hypermania reads these environment variables at startup:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3111` | Port for the Hypermania web server. |
| `OLLAMA_BASE` | `http://127.0.0.1:11434` | Base URL of the Ollama server. |
| `HYPERMANIA_LOG_FILE` | `<project>/hypermania.log` | Absolute path for the diagnostic log. Use a separate path for test or service instances. |

macOS and Linux:

```bash
PORT=3001 OLLAMA_BASE=http://192.168.1.50:11434 npm start
```

Windows PowerShell:

```powershell
$env:PORT = 3001
$env:OLLAMA_BASE = "http://192.168.1.50:11434"
npm start
```

You can also change the active endpoint from the **Settings** page using a hostname or IP address, such as `http://ollama.lan:11434`. That change takes effect immediately, but resets when Hypermania restarts. Set `OLLAMA_BASE` in your shell or Linux service environment file to make it persistent.

## Using Hypermania

- Hypermania reads installed models and capabilities directly from Ollama. Choose the active model and thinking level from the conversation header, or use the adjacent information button to review the model capabilities Ollama reports. Use **Settings** for endpoint, thinking, context length, system instruction, and model refresh.
- Changing the model in an existing chat affects the next response and keeps earlier messages as context. New responses record which model generated them; older saved responses created before this metadata was added display **Model not recorded**.
- Image uploads are blocked if the selected model does not support vision.
- A chat containing directly uploaded images can only be continued with a vision-capable model because those earlier images remain part of its context.
- A PDF's page images are sent on its first turn. Later turns retrieve at most six relevant pages (up to 24,000 characters of extracted text) instead of resending every page image. A vision model also receives the selected page images; a text-only model can continue from extractable text. Scanned or layout-dependent pages may still require a vision model.
- **Thinking** is sent only when the selected model supports it. A thinking selector appears beside capable models and shows the levels Ollama reports. Models with boolean-only thinking controls show **Auto**, **Off**, and **On**; **Low**, **Medium**, and **High** appear only for models that support named effort levels, such as GPT-OSS. Hypermania does not invent effort levels for models that do not advertise them, because unsupported values may be ignored, rejected, or resolved to the model's default.
- **Context length** is passed to Ollama as `options.num_ctx`. Larger contexts consume more memory or VRAM.
- Progress identifies the PDF being prepared, then distinguishes waiting for Ollama, receiving reasoning (when the model emits it), and generating an answer. After eight seconds without new model output, the label retains the last observed phase and shows elapsed time as `25s`, `8m50s`, or `1h30m25s`. Successful polls do not reset that timer. Reconnection, retry, polishing, and saving have separate statuses. These labels cannot identify Ollama's internal loading, queue, or prompt-processing stage, percentage complete, or remaining time.
- **System instruction** is stored in the current browser and sent before every conversation. It defaults to requesting English unless the user asks for another language; edit it in **Settings**, or save it blank to disable it.
- Markdown and TeX math are rendered after a response completes. During streaming, content stays plain text so the layout does not jump. Inline math may use `$...$` or `\(...\)`; display math may use `$$...$$` or `\[...\]`. Code spans and fenced code blocks remain literal.
- Chat generation runs on the Hypermania server, so a mobile browser can suspend the tab and catch up on missed response chunks when it returns. Recoverable results are held in server memory for up to six hours; restarting Hypermania clears them.
- The attachment button shows pending image/PDF counts. Choose **Show** to review or add files in a compact, scrollable tray; PDFs use filename rows and images retain small thumbnails. Adding files or sending collapses the tray to keep chat progress visible. You can inspect it during a request, while adding/removing files remains locked. Paste clipboard images into the message box to attach them, too. Failed sends retain pending files for retry; successful sends clear the pending tray.
- Press **Enter** to send a message; use **Shift+Enter** for a new line.
- Open **Manage prompts** in the header to launch the dedicated blue **Prompt library** management page in a new tab, preserving your current chat. Create or select a reusable prompt there. Edit its name or text and choose **Save version** to keep a dated snapshot; unchanged saves do not add versions. Expand **Version history** to review earlier text. **Copy prompt** copies the editor text to paste into chat. If clipboard access is blocked, the text is selected for manual copying. **Delete prompt** permanently removes that prompt and its versions.
- Saved prompts and all versions are stored unencrypted in this browser's local storage, specific to this Hypermania address. They are not synced or sent to the server until used in a message; clearing site data removes them. Storage failures preserve editor text for copying. Use **Reload prompts** if another tab changes the library (copy any unsaved edits first); avoid editing the library simultaneously in multiple tabs.
- Completed conversations are saved in the browser with IndexedDB, including PDF page text and images needed for follow-ups. Chat history is specific to the current browser profile and exact Hypermania address, so changing devices, browser profiles, hostnames, or ports shows a different history.
- Use **New chat** to start a blank conversation. Select a saved chat to review or continue it, or use its trash-can control to permanently remove it from this browser's Hypermania storage.
- Each conversation has a stable thread ID. Each send has a separate request ID that follows its PDF rendering, model generation, and log entries. Failed sends preserve the draft and attachments, offer a retry, and show the request ID as a safe support reference.
- Browser events and server request summaries are appended to `hypermania.log` beside `server.js`. To trace a reported failure, search that file for the request ID shown in the UI; matching entries also include the conversation `threadId` and, for model generations, the server `jobId`.

## Linux systemd install

From a cloned project directory on a Linux machine, run:

```bash
sudo bash scripts/install-linux-service.sh
```

The installer:

- Copies the app to `/opt/hypermania` (excluding local logs and `node_modules`).
- Creates an unprivileged `hypermania` service user.
- Creates `/etc/hypermania/hypermania.env` for `PORT` and `OLLAMA_BASE`.
- Creates, enables, and starts `hypermania.service`.

When run in a terminal, it interactively asks for the install directory, service user, web port, and Ollama URL. Press Enter at a prompt to accept its shown default. For an unattended install, add `--non-interactive`.

Useful custom install example:

```bash
sudo bash scripts/install-linux-service.sh \
  --port 3001 \
  --ollama-base http://127.0.0.1:11434 \
  --non-interactive
```

After installation:

```bash
sudo systemctl status hypermania
sudo journalctl -u hypermania -f
sudo systemctl restart hypermania
sudo nano /etc/hypermania/hypermania.env
```

If you edit `hypermania.env`, restart the service for changes to apply. Re-running the installer updates the code but preserves the existing environment file.

## Security and operations

- Hypermania listens on all network interfaces, has no authentication, and permits cross-origin API requests. Keep it on a trusted network. Use a firewall and authenticated reverse proxy before exposing it externally.
- Saved chats can include prompts, model reasoning, and attachment data. They remain unencrypted in the browser profile until deleted or browser site data is cleared; browser deletion is not guaranteed forensic erasure.
- In-progress and recently completed responses are retained in server memory for reconnecting browsers. Retention is bounded to 50 responses, 8 million characters per response, six hours after completion, and 30 minutes of generation time.
- The browser endpoint control may be changed only from the local machine; use `OLLAMA_BASE` for the durable default.
- Ollama must be reachable by the machine and account running Hypermania. For the default setup, ensure `ollama serve` or the Ollama system service is running.
- New image and PDF input requires a multimodal model. Text-only models are identified in the UI and will not receive new attachments, but they can continue a PDF conversation when useful page text was extracted. PDF processing requires Poppler (`pdfinfo`, `pdftotext`, and `pdftoppm`) on the Hypermania server; PDFs are limited to 25 MB and 32 pages, and conversations are limited to 16 PDFs.
- Error banners intentionally show a high-level reason instead of raw server or Ollama diagnostics. Detailed technical failures are recorded with correlation IDs. Terminal Ollama timing and token/cache counters are logged when available, but prompts, file names, attachments, extracted text, and model output are not deliberately logged.
- `hypermania.log` grows over time; rotate or archive it as part of normal host maintenance.

## Development

The editable stylesheet is `public/style.scss`. Rebuild it after changes:

```bash
npm run build:styles
```

For live stylesheet compilation during development:

```bash
npm run watch:styles
```

Run the core regression suite with:

```bash
npm test
```

The suite validates saved-chat, document-context, and math-rendering contracts and starts an isolated Hypermania server with mock Ollama and PDF tools to test static assets, proxy streaming, PDF text extraction, bounded follow-up context, configuration, and common error responses.

Run the faster dependency-free surface and diagnostic contract checks with:

```bash
npm run test:surface
```

These checks protect the intended mobile hierarchy, attachment and recovery controls, progress labels, accessibility attributes, and isolated logging configuration. They do not replace a real-browser layout test.

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Static-file server and Ollama API proxy. |
| `public/` | Browser interface, client logic, and styles. |
| `scripts/install-linux-service.sh` | Interactive or unattended Linux systemd installer. |
