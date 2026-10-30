# Server-local persistence — implementation verification

Date: 2026-10-29. Status: complete. Independent consultant code review: PASS.

## Delivered behavior

The default store is `data/hypermania.sqlite` beside `server.js`. Chats with attachment context, prompt versions, and all five preferences are shared across browsers connecting to the installation. Operational persistence no longer uses browser IndexedDB/localStorage. Legacy storage is read only by the optional Settings import action, which preserves originals and reports duplicate/conflicting records.

The user explicitly approved raising the Node baseline to use built-in SQLite. Package metadata, README, and Linux installer require Node 24.14.1 or newer. No npm dependency was added or upgraded, so dependency advisory checks for a new package are not applicable. The local Node 24.14.1 runtime prints its SQLite experimental-feature warning; no warning is suppressed.

## Changed areas

- `storage.js` / `storage-api.js`: transactional SQLite schema, separate immutable attachment chunks, summary-only lists, revisions, durable mutation receipts, tombstones, import receipts, startup integrity/version checks, private responses, origin/header/method/body validation, and static-path exclusion.
- `public/server-storage.js`: bounded transfers, active-chat-only attachment cache, durable-save acknowledgment/retry handling, import fingerprinting, and timeout covering headers plus body.
- `public/app.js` / `public/preferences.js` / `public/settings.js`: asynchronous preference bootstrap, shared persistence, save recovery, stale-read protection, load/delete lifecycle locks, and protection of newer settings edits during acknowledgment.
- `public/prompt-library.js` / `public/saved-prompts.js`: shared validation, asynchronous prompt operations, dated versions, conflict/reload recovery, and editor preservation.
- `public/browser-import.js` and page markup: disclosed optional schema-v1/v2 chat and prompt import, preference selection, reload/save-retry controls, and shared-storage labels.
- `scripts/install-linux-service.sh`, `.gitignore`, README, and package metadata: approved runtime baseline, data exclusions/preservation, restricted ownership, proxy configuration, backup/restore and limits.
- Tests and optional `scripts/verify-server-storage.cjs`: isolated synthetic and mocked verification. Existing unrelated UI/style work was preserved; stylesheet compilation regenerated its current source.

## Final checks after the modified-code comment pass

| Check | Result |
| --- | --- |
| `npm run build:styles` | Passed. |
| `npm test` | **146 passed, 0 failed, 0 skipped**. |
| `node --check` on the 11 runtime/storage/browser-verification scripts | Passed. No repository lint command is configured. |
| `git diff --check` | Passed; Git printed only line-ending conversion notices. |
| Git Bash `bash -n scripts/install-linux-service.sh` | Passed. |
| Optional browser script using the existing bundled Playwright and headless Edge | Passed twice, including after final runtime fixes. |
| Independent read-only consultant review | PASS after findings were fixed and covered by targeted tests. |

Browser verification uses a temporary SQLite file, a mock Ollama HTTP service, and separate browser contexts at 1149×773 and 390×844. It exercised an actual frontend send/save, second-browser reopen, shared prompt versions, stale-editor conflict, reload/reapply of the same edit, shared system instruction, legacy schemas 1 and 2 with attachment references, dated prompt import, repeat-import skips, retained browser originals, process-stop store reopening, and zero page errors. It did not use real model inference or PDF processing.

## Requirement traceability

| Requirements | Evidence |
| --- | --- |
| FR-001–003 | Store/client tests cover restart, summary-only list, full context round trip, model attribution, immutable chunks, atomic reference publication/deletion, and stale writes/deletes. Browser smoke covers shared saved chats. |
| FR-004–006 | Preference/editor/store tests cover blank instructions, defaults, unchanged versions, literals, revisions, duplicate save receipts, import receipts/tombstones, delayed reads, and newer edits during acknowledgment. Browser smoke covers conflict → reload → reapply. |
| FR-007–008 | Simulated database abort leaves prior values intact; killing a writer mid-transaction rolls back on reopen. Corrupt and foreign databases remain unchanged. Client tests cover lost acknowledgments and stalled response bodies. UI tests cover load/delete locks; Retry saving does not invoke inference. |
| FR-009–010 | Browser smoke imports actual synthetic IndexedDB v1/v2 records and localStorage prompts twice without deleting originals. Client/store tests reject divergent import fingerprints and skip an original even after the server copy is deleted. Normal operations use server APIs. |
| FR-011–012 | HTTP and API tests cover cross-origin/header/content-type/method/size rejection, invalid IDs/shapes, static URL rejection, explicit HTTPS public origin over an HTTP backend, ignored forwarded headers, and Windows uppercase static-path aliases. |
| FR-013–014 | Installer syntax/source review confirms source-data exclusions, stopped updates, preservation and ownership. Temporary stopped-store backup/restore test passed. README documents operations and schema limits. Actual Linux service execution remains unverified. |

## Independent review findings and fixes

The consultant identified lifecycle locks needed during chat loads and deletion, instruction acknowledgment overwriting newer text, stale prompt retry state surviving reload, timeout ending before body consumption, static database paths including Windows aliases, unbounded multi-chat cache retention, stale Keep working controls, delayed preference reads overwriting newer writes, and TLS proxy origin handling. Each was corrected; focused tests or the browser smoke exercise the relevant failure/recovery path. No remaining material flaw was identified in the final source review.

## Performance and operational limits

- One synthetic 40 MiB rendered image became about 53.3 MiB of base64, was stored in 4 MiB chunks, and round-tripped through SQLite. A text-only follow-up produced no additional attachment uploads. Reopening that fixture with the integrity check took approximately 87–88 ms in focused local runs; this is host-specific evidence, not a production benchmark.
- Encoded image limit: 64 MiB; encoded chat attachment limit: 2 GiB; metadata/prompt-library request limit: 64 MiB. These are enforced limits, not a tested 2 GiB capacity guarantee. Startup integrity-check work scales with stored data.
- One process and one shared trusted installation; no authentication/account isolation or at-rest encryption is added. `HYPERMANIA_ORIGIN` must be set to the exact external origin behind TLS termination.
- Unsent drafts, pending files, and generation jobs remain temporary. A completed response is durable only after save acknowledgment.
- Actual Linux systemd install/update, POSIX service-account permissions, physical disk exhaustion, and power-failure durability were not exercised on this Windows host. Database rollback, crash interruption, backup restoration, corruption preservation, and API failure behavior were tested using temporary stores. No real GPU inference, batch PDF upload, package installation, commit, or live service restart was performed.
