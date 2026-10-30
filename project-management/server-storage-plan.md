# Server-local persistence — review and implementation plan

Status: Implemented, 2026-10-29. User approved implementation and Node 24 built-in SQLite. Independent consultant code review: PASS. See `server-storage-verification.md` for final evidence and limits. Historical discovery below describes the pre-change application.

## Current code and data flow

The application uses vanilla browser JavaScript and a CommonJS Node HTTP server. No `PROJECT.md` exists. `package.json`/README advertise Node 18 or newer; KaTeX is the only production dependency.

| Entry point | Current responsibility | Required change |
| --- | --- | --- |
| `public/app.js`: `openChatDatabase`, `loadConversationHistory`, `selectConversation`, `persistCurrentConversation`, `deleteConversation` | IndexedDB `hypermania-chats`; separate `conversations` summaries and `conversationData` schema-v1/v2 payloads. Save atomically checks revisions and writes metadata/context together. | Replace operational IndexedDB calls with asynchronous server APIs; retain legacy reading only for explicit import. Preserve model-generation and save-failure separation. |
| `public/chat-history.js`, `public/document-context.js` | Shared Node/browser shape validation and request-context construction. | Reuse valid contracts on the server; add server boundary checks/limits without changing model context semantics. |
| `public/prompt-library.js`, `public/saved-prompts.js` | Synchronous localStorage library, dated versions, snapshot conflict detection, editor recovery. | Move durable operations to asynchronous server requests with transactional revisions; retain validation, version rules, and unsaved editor protection. |
| `public/preferences.js`, `public/settings.js`, chat initialization | Synchronous localStorage reads/writes for five preferences; several startup paths also write values. | Bootstrap server preferences before consumers initialize; make saves explicit/asynchronous and prevent default/fallback initialization from overwriting a newer server value. |
| `server.js` | Static files, Ollama proxy, PDF processing, diagnostic log, in-memory recoverable jobs. Built-in HTTP routing and `readBody(req, maxBytes)` already exist. `sendJson` adds wildcard CORS. | Add narrowly scoped storage routes and a separate sensitive-response policy. Keep generation jobs and runtime Ollama configuration unchanged. |
| `scripts/install-linux-service.sh` | Copies checkout, then recursively assigns root ownership. | Exclude source `data/`, preserve installed data, restore restricted service ownership for the data directory after code updates. |

Current save flow is model completion → browser history/context → IndexedDB commit → saved sidebar. Proposed flow is model completion → storage API → transaction → local database → acknowledgment → saved sidebar. This preserves the existing point at which a conversation becomes saved.

## Storage recommendation and tradeoffs

Recommend a file-backed SQLite database at `path.join(__dirname, "data", "hypermania.sqlite")`, outside the static root. It requires no database server. Keep one Hypermania process per data directory for the initial release; use bounded transaction contention handling and explicit revisions.

| Choice | Benefit | Cost / failure mode | Decision |
| --- | --- | --- | --- |
| One JSON file for everything | No dependency, easy manual inspection | Rewrites all histories/images; difficult concurrent updates, corruption recovery, and lightweight listing | Reject for this workload. |
| Per-chat JSON plus separate attachment files and index | No database driver; independent records | Requires custom index recovery, atomic multi-file delete/save, blob ownership, locking, and backups | Possible fallback for tightly bounded use, but more application persistence machinery. |
| SQLite file with separate metadata/context/attachment records | Transactions, lightweight summary queries, revision checks, attachment updates without rewriting every history | Requires driver approval, platform/runtime verification, schema/backup handling; large API payloads still need bounds | Recommended. |

Resolved: the user explicitly approved Node 24 and built-in SQLite. Minimum tested runtime is 24.14.1. No driver dependency was added; security checks for a new package are not applicable.

Keep the schema small: conversations (summary, revision, history with attachment references), conversation-owned attachment records (direct images and structured PDF page payloads), prompts (revision and dated version arrays), preferences (versioned values), and only the import bookkeeping required for retry safety. Persist unchanged attachment payloads once; use transactional ownership/reference checks. Keep list queries free of attachment reads. No general-purpose storage framework or ORM is needed.

SQLite does not remove browser/HTTP payload costs. Existing server limits permit 16 PDFs with up to 40 MiB rendered images each: approximately 853.3 MiB of base64 across a conversation before text/history overhead. Direct uploaded images currently have no explicit byte cap in the inspected client path. This is an upper-bound analysis, not a measured typical workload. Use bounded per-attachment/page transfers and measure synthetic fixtures before fixing API limits; avoid sending the entire conversation's images on each text-only update.

## Implementation sequence

1. **Finalize scope and compatibility (FR-001, 003, 005, 011).** Confirm shared preferences, actual deployment runtime/OS, pinned driver approval/security results, and tested payload limits. Explain shared access and any required compatibility change before editing runtime code.
2. **Implement the storage module (FR-001–007, 011, 014).** Add a small `storage.js` module responsible for database initialization, schema versions, prepared statements, transactions, attachment ownership, revisions, and bounded retry/idempotency rules. Initialize before accepting storage traffic; preserve an existing corrupt database and expose a clear unavailable state. Test against temporary paths.
3. **Add storage APIs (FR-002–008, 011–012).** Use exact route/method dispatch under `/api/storage/`: conversation summaries and single-record operations; conversation-owned attachment/page operations; prompt operations; preference load/patch; import operations. Define stable error codes for validation, missing record, conflict, oversize, and unavailable storage. Use no-store responses and a storage-specific origin/header policy, including OPTIONS handling before the current global wildcard branch. Return success only after commit.
4. **Move chat persistence (FR-002–003, 006–008).** Replace IndexedDB operational paths, keeping shared validators and existing render/follow-up behavior. Upload new attachment payloads through bounded operations, then atomically publish their references with the chat; abandoned staging payloads need bounded cleanup. Save retries reuse mutation identifiers; conflicts preserve the completed response for copying and reload/recovery. Do not rerun generation on a save failure.
5. **Move prompts and preferences (FR-004–008, 010).** Adapt library/editor actions to promises, disable duplicate submissions, and retain unsaved text on errors. Load preferences before chat/settings consume them. Keep an in-memory page snapshot with server revisions; avoid introducing persistent browser caches or automatic startup writes. Refresh/reload exposes other browsers' changes without discarding current edits; real-time push is outside scope.
6. **Add explicit legacy import (FR-009–010).** Present counts/disclosure first, validate original records, and import one conversation/prompt at a time with bounded attachment transfers. Map arbitrary legacy IDs to safe server IDs while preserving thread metadata where valid. Track source identity/content sufficiently to recognize retries; identical records are skipped, divergent collisions are reported without overwrite. Preserve legacy source data and show per-record results. Preferences require explicit selection. Partial batches resume safely; batch-wide atomicity is unnecessary.
7. **Protect operations and document workflows (FR-013–014).** Update installer exclusions/ownership and `.gitignore`; keep source code root-owned. Document shared access, storage path, import, failure recovery, size limits, database permissions, stopped-service backup/restore, schema upgrades, and unchanged in-memory job limits. Exclude live stores from tests and installer copy sources.
8. **Verify and review.** Execute the companion acceptance checks using synthetic attachments and mocked Ollama/PDF tools. Run the full practical suite, comment pass, and focused rechecks. Obtain a fresh read-only consultant review of requirement coverage and regression/security risks before declaring implementation complete.

## Risks and scope boundaries

- Moving browser-private data onto an unauthenticated server makes it accessible to trusted clients reaching that server. Same-origin controls address browser cross-site access, not direct unauthorized network clients. Accounts/authentication would be a separate project; do not expose this service publicly without the existing authenticated-proxy boundary.
- Shared preferences can change future model requests on other devices. Use clear shared-setting labels and revision conflicts; an already running request retains its starting policy.
- Failed import must not erase browser originals or silently replace server records. A browser can import only its own origin/profile.
- Store files contain unencrypted prompts, reasoning, and attachment content. Limit filesystem access and keep them out of Git, static serving, diagnostic payloads, and installation archives.
- Synthetic tests must determine attachment transfer/memory behavior; SQLite alone does not prove acceptable performance. If adequate limits require lowering existing supported inputs, stop for an explicit compatibility decision.
- Existing uncommitted UI/attachment edits, including `public/app.js`, `public/index.html`, `public/settings.html`, and `test/attachments.test.js`, plus untracked UI planning files, belong to other work. Preserve them and integrate only the storage-related diff during implementation.

## Review evidence

- Inspected browser storage entry points, validators, settings initialization, HTTP response/body/static handling, package/runtime declarations, installer, and existing persistence tests.
- Ran `node --test test/chat-history.test.js test/document-context.test.js test/preferences.test.js test/prompt-library.test.js`: **29 passed, 0 failed**.
- A read-only Node probe confirmed the current summary validator accepts non-UUID legacy keys and calculated the aggregate rendered-image/base64 upper bound. No application data was read or changed by that probe.
- Independently ran the consultant's synthetic payload check: one 40 MiB image encoded in an otherwise valid document was accepted by `isValidDocumentContext`; the serialized context was **55,924,252 bytes**, with **81 ms** serialization and **57 MiB** reported JavaScript heap use in that run. This demonstrates the transfer/rewrite concern; it is neither a representative workload benchmark nor a SQLite performance test. External buffer/base64 memory is not included in that heap figure.
- The independent read-only consultant agreed with SQLite, separate immutable attachment payloads, explicit asynchronous preference initialization, and bounded migration. Its material concerns are incorporated above. Architecture feasibility is supported by code inspection; actual driver compatibility, restart durability, and operational performance remain unverified until implementation.
- At planning time no implementation/deployment tests had run. Final restart/crash/backup, browser migration, and synthetic attachment evidence is recorded in `server-storage-verification.md`. No real model inference or PDF batch upload ran. Linux execution remains unavailable.
