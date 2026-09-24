# Hypermania

A focused, local-first chat interface for [Ollama](https://ollama.com). Hypermania streams responses as they arrive, renders completed answers as Markdown, and supports image prompts with vision-capable models.

## Highlights

- Connect to a local or trusted-network Ollama instance.
- Stream chats live, with a model selector in chat and advanced behavior controls on a dedicated Settings page.
- Attach images or PDFs, preview the resulting pages, and send them to compatible vision models. PDFs are rendered locally into PNG page images before they reach Ollama.
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

> The app has no production npm dependencies. Sass is installed as a development dependency to compile the stylesheet before startup.

## Configuration

Hypermania reads these environment variables at startup:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3111` | Port for the Hypermania web server. |
| `OLLAMA_BASE` | `http://127.0.0.1:11434` | Base URL of the Ollama server. |

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

- Hypermania reads installed models and capabilities directly from Ollama. Choose the active model from the chat header; use **Settings** for endpoint, thinking, context length, and model refresh.
- Image uploads are blocked if the selected model does not support vision.
- **Thinking** is sent only when the selected model supports it; individual models may still ignore a chosen mode.
- **Context length** is passed to Ollama as `options.num_ctx`. Larger contexts consume more memory or VRAM.
- Markdown is rendered after a response completes. During streaming, content stays plain text so the layout does not jump.
- The **Add images** tray supports selecting files and drag-and-drop. Paste clipboard images into the message box to attach them, too.
- Press **Enter** to send a message; use **Shift+Enter** for a new line.
- Browser events and proxy request summaries are appended to `hypermania.log` beside `server.js`.

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
- The browser endpoint control may be changed only from the local machine; use `OLLAMA_BASE` for the durable default.
- Ollama must be reachable by the machine and account running Hypermania. For the default setup, ensure `ollama serve` or the Ollama system service is running.
- Image and PDF input requires a multimodal model. Text-only models are identified in the UI and will not receive attachments. PDF rendering requires Poppler (`pdfinfo` and `pdftoppm`) on the Hypermania server; PDFs are limited to 25 MB and 32 pages.
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

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Static-file server and Ollama API proxy. |
| `public/` | Browser interface, client logic, and styles. |
| `scripts/install-linux-service.sh` | Interactive or unattended Linux systemd installer. |
