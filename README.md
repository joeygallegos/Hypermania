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

- [Node.js](https://nodejs.org/) 24.14.1 or newer.
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
| `HYPERMANIA_DATA_FILE` | `<project>/data/hypermania.sqlite` | Absolute SQLite path; must remain outside static asset directories. Use a temporary path for test instances. |
| `HYPERMANIA_ORIGIN` | Request origin | Exact public origin, such as `https://chat.example.com`, required when a reverse proxy terminates TLS. No trailing slash; forwarded headers are not trusted. |
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

- Hypermania reads installed models and capabilities directly from Ollama. Open the compact model summary in the conversation header to change the model/thinking level or inspect capabilities. If Ollama is unavailable or has no installed models, the chat shows **Retry** and preserves your draft; Send stays disabled until an installed model is available.
- The chat fits the available viewport, including short windows. The message editor grows as you type within a height limit; **Expand/Collapse** provides more room for long prompts. **Stop** replaces Send during active model work. On small screens, **Menu** holds navigation and **Chats** opens history without leaving the conversation. **Read** toggles reading mode, which reduces chrome and hides the desktop history panel while keeping its Chats action available.
- **Settings** opens in a separate tab to preserve the current draft and generation. Thinking and context changes save automatically; the system instruction shows unsaved/saved feedback and requires **Save instruction**. Changes apply between sends, including the system instruction used by follow-up model stages. Navigating away from a draft, pending attachments, or an active request triggers the browser's standard leave-page warning; this does not provide recovery after a reload or server restart.
- Scroll up to read earlier output without being pulled back by new chunks. Choose **Latest** to resume following the response. The **?** control provides keyboard and Keep working help by touch or keyboard.
- Changing the model in an existing chat affects the next response and keeps earlier messages as context. New responses record which model generated them; older saved responses created before this metadata was added display **Model not recorded**.
- Image uploads are blocked if the selected model does not support vision.
- A chat containing directly uploaded images can only be continued with a vision-capable model because those earlier images remain part of its context.
- A PDF's page images are sent on its first turn. Later turns retrieve at most six relevant pages (up to 24,000 characters of extracted text) instead of resending every page image. A vision model also receives the selected page images; a text-only model can continue from extractable text. Scanned or layout-dependent pages may still require a vision model.
- **Thinking** is sent only when the selected model supports it. The model-options panel shows a thinking selector for capable models and shows the levels Ollama reports. Models with boolean-only thinking controls show **Auto**, **Off**, and **On**; **Low**, **Medium**, and **High** appear only for models that support named effort levels, such as GPT-OSS. Hypermania does not invent effort levels for models that do not advertise them, because unsupported values may be ignored, rejected, or resolved to the model's default.
- **Context length** is passed to Ollama as `options.num_ctx`. Larger contexts consume more memory or VRAM.
- Progress identifies the PDF being prepared, then distinguishes waiting for Ollama, receiving reasoning (when the model emits it), and generating an answer. After eight seconds without new model output, the label retains the last observed phase and shows elapsed time as `25s`, `8m50s`, or `1h30m25s`. Successful polls do not reset that timer. Reconnection, retry, polishing, and saving have separate statuses. These labels cannot identify Ollama's internal loading, queue, or prompt-processing stage, percentage complete, or remaining time.
- **System instruction** is stored on the Hypermania server and sent before every conversation. It defaults to requesting English unless the user asks for another language; edit it in **Settings**, or save it blank to disable it.
- Markdown and TeX math are rendered after a response completes. During streaming, content stays plain text so the layout does not jump. Inline math may use `$...$` or `\(...\)`; display math may use `$$...$$` or `\[...\]`. Code spans and fenced code blocks remain literal.
- Chat generation runs on the Hypermania server, so a mobile browser can suspend the tab and catch up on missed response chunks when it returns. Recoverable results are held in server memory for up to six hours; restarting Hypermania clears them.
- The attachment button shows pending image/PDF counts. Choose **Show** to review or add files in a compact, scrollable tray; PDFs use filename rows and images retain small thumbnails. Adding files or sending collapses the tray to keep chat progress visible. You can inspect it during a request, while adding/removing files remains locked. Paste clipboard images into the message box to attach them, too. Failed sends retain pending files for retry; successful sends clear the pending tray.
- Press **Enter** to send a message; use **Shift+Enter** for a new line.
- Open **Manage prompts** in the header to launch the dedicated blue **Prompt library** management page in a new tab, preserving your current chat. Create or select a reusable prompt there. Edit its name or text and choose **Save version** to keep a dated snapshot; unchanged saves do not add versions. Expand **Version history** to review earlier text. **Copy prompt** copies the editor text to paste into chat. If clipboard access is blocked, the text is selected for manual copying. **Delete prompt** permanently removes that prompt and its versions.
- Saved prompts and all versions are stored on the server and shared by browsers connecting to it. Storage failures preserve editor text for copying. Use **Reload prompts** to read another browser's changes (copy unsaved edits first). Conflicting saves are rejected instead of overwriting newer data.
- Completed conversations are saved in the server's local SQLite database, including reasoning, model attribution, PDF page text, and images needed for follow-ups. Browsers connecting to the same server share history. Use **Reload chats** to see changes from another browser. Clearing browser site data does not delete server records.
- Use **New chat** to start a blank conversation. Select a saved chat to review or continue it, or use its trash-can control to permanently remove it from shared server storage.
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

If you edit `hypermania.env`, restart the service for changes to apply. Re-running the installer stops the service during the update, preserves the existing environment file and installed `data/` directory, then starts the service. Source-checkout `data/` is excluded from the copy. The service account owns only the data directory and diagnostic log; application code remains root-owned.

## Server storage and browser import

Hypermania uses Node's built-in SQLite at `data/hypermania.sqlite` beside `server.js`, independent of the working directory. No database service or additional npm dependency is required. Chats, prompts, and the five response preferences are shared across this installation; there are no separate private user accounts. In-memory generation jobs, unsent drafts, and pending files retain their existing lifetime. Completed responses become durable only after saving is acknowledged.

Open **Settings → Import browser data → Review browser import** to import older IndexedDB chats and localStorage prompt versions from the current browser profile and Hypermania address. The preview asks before sharing those records. Original browser data remains untouched. Repeating the import skips previously imported originals; conflicting or unreadable records are reported instead of replaced. Each other browser/profile/address must import its own data. Importing preferences is a separate checkbox; reload shared preferences afterward to update the Settings controls.

Preferences load before page controls initialize. **Reload preferences** reads changes saved elsewhere; chat also refreshes preferences when its window regains focus. Running requests retain their starting settings. A conflict preserves editor text for copying and requires reloading the latest data before reapplying edits. A failed chat save leaves the answer visible and exposes **Retry saving**, which does not run inference again. Copy an unsaved answer before reloading; a failed save is not durable.

Attachment strings are transferred in 4 MiB chunks and stored separately from chat text. Text-only follow-ups reuse stored attachments. Limits are 64 MiB per encoded image (about 48 MiB of original image bytes), 2 GiB of encoded attachment data per chat, and 64 MiB per metadata/prompt-library request. Requests exceeding limits fail explicitly without truncation. Prompt libraries support up to 10,000 prompts and 10,000 versions per prompt within the request limit. Unreferenced uploads expire after seven days, with cleanup at startup and hourly. Use one Hypermania process per data directory.

For backup, stop Hypermania (for systemd, `sudo systemctl stop hypermania`), copy the entire `data/` directory to a private backup location, then restart. To restore, stop the service, preserve a copy of the current directory, restore the backed-up directory, restore service-account ownership and restrictive permissions (directory `0700`, files `0600` on Linux), then restart. Startup checks SQLite integrity and schema version; the integrity scan takes longer as stored data grows. The synthetic 40 MiB rendered-image fixture is tested, but the 2 GiB ceiling is not a measured capacity guarantee. A corrupt or unsupported database is preserved and storage remains unavailable until repaired/restored. Never copy only the database file while the service is writing. Back up before a future schema upgrade; this release creates schema version 1 and does not migrate an existing server database.

## Security and operations

- Hypermania listens on all network interfaces, has no authentication, and permits cross-origin API requests. Keep it on a trusted network. Use a firewall and authenticated reverse proxy before exposing it externally.
- Saved chats can include prompts, model reasoning, and attachment data. They remain unencrypted in the server data directory until deleted; deletion is not guaranteed forensic erasure. Everyone able to use this unauthenticated server can access its shared data.
- **Keep working** beside Send is enabled by default and remembered on this server. It removes Hypermania's generation deadline, so complex requests can continue beyond an hour. Turn it off to use the 30-minute limit. This policy also applies to follow-up answer generation.
- **Stop** disconnects the current model request and restores your submitted message and pending attachments for retry, discarding the unfinished answer. It does not shut down Ollama; Ollama must honor the request disconnect. If offline, Stop stays pending until Hypermania can confirm the outcome. A response that already finished may complete normally if it wins the race with Stop.
- In-progress and recently completed responses are retained in server memory for reconnecting browsers. The open page keeps retrying temporary connection failures and retrieves missed output from the same attempt without launching another generation. Retention remains bounded to 50 responses, 8 million characters per response, and six hours after completion. Real model/network errors and resource limits can still end a request.
- Keep the page open to retain its active attempt. Reloading or closing the page does not restore its session, and restarting Hypermania loses in-memory jobs. This feature cannot recover a response that failed before it was enabled.
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

Run the faster surface and diagnostic contract checks with:

```bash
npm run test:surface
```

These checks protect the intended mobile hierarchy, attachment and recovery controls, progress labels, accessibility attributes, and isolated logging configuration. They do not replace a real-browser layout test.

Optional browser verification uses an existing Playwright installation (it is not an application dependency): set `HYPERMANIA_PLAYWRIGHT` to its module directory, then run `node scripts/verify-server-storage.cjs`. This launches isolated headless Edge sessions with a temporary database and mock Ollama. It checks shared chat/prompt/preferences, conflicts, and browser imports without real model inference or PDF uploads.

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Static-file server and Ollama API proxy. |
| `public/` | Browser interface, client logic, and styles. |
| `storage.js`, `storage-api.js` | Transactional SQLite persistence and storage-only HTTP access rules. |
| `data/` | Private runtime database and journals; excluded from Git and installer source copies. |
| `scripts/install-linux-service.sh` | Interactive or unattended Linux systemd installer. |
