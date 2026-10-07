# Known risks

## PDF rendering resource exhaustion

PDF rendering accepts documents up to 25 MB and 32 pages, then uses Poppler to create PNG page images. The current rendered-output limit is checked after Poppler has produced the images. A PDF with unusually large page dimensions could therefore consume substantial temporary disk space or memory before Hypermania rejects it.

Current mitigation: keep Hypermania on a trusted network and enforce the existing input, page-count, render-time, and rendered-output limits.

Follow-up: cap rendered page dimensions before invoking Poppler, such as by using its scaling options or validating PDF page dimensions.

## Aggregate size of multiple PDFs

The limits apply to each PDF render request. A user can attach several individually valid PDFs, whose rendered page images are combined into one Ollama request. This can create an oversized browser payload or exceed the selected model's practical vision/context limits.

Current mitigation: the UI processes one request at a time, and each PDF is subject to its own input, page-count, and rendered-output limits.

Follow-up: apply a per-send aggregate limit for PDF count, page count, and rendered bytes.

## PDF error reporting when logging fails (resolved)

PDF render logging is now best-effort. If `hypermania.log` cannot be written, Hypermania reports the logging failure to stderr without replacing the original PDF response.

Operational limitation: if both the log file and service stderr are unavailable, the UI still receives its request reference but detailed diagnostics cannot be retained.
