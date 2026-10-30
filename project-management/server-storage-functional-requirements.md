# Server-local persistence — functional requirements

Status: Implemented, 2026-10-29. User approved implementation and explicitly approved Node 24 built-in SQLite. See `server-storage-verification.md` for evidence and limits.

## Scope and assumptions

Replace durable browser storage with one shared, server-local store. Proposed scope includes completed conversations and their attachment context, saved prompts and all versions, and the five existing preferences. Browsers connecting to the same installation see the same saved data. This assumes a single trusted household/team installation, not separate user accounts. Sharing previously private browser data is a deliberate behavior change that must be disclosed in the UI and README.

Exclude unsent drafts, pending files, durable generation jobs, accounts, synchronization between servers, and persistence of the runtime Ollama endpoint. Keep existing generation, Stop, and reconnect behavior. A response is durable only after its save succeeds; closing the browser before that acknowledgment is not a guaranteed save.

## Functional requirements

| ID | Requirement and acceptance condition |
| --- | --- |
| FR-001 | Store durable data by default in `<directory containing server.js>/data/hypermania.sqlite`, independent of the process working directory. Never place it under `public/`. Create an empty store only when none exists; reopening or restarting must preserve records. |
| FR-002 | List, open, continue, and delete saved conversations from any browser connected to the installation. Preserve titles, creation/update times, selected model, thread IDs, revisions, message order, content, reasoning, and per-response model attribution. Listing summaries must not fetch or deserialize attachment payloads. |
| FR-003 | Preserve direct images and PDF names, page text, page images, page numbers, and message/document references required for existing follow-up behavior. Store attachment payloads separately so adding a text response does not rewrite unchanged images. Never truncate data silently. Deleting a chat removes its owned attachment records atomically. |
| FR-004 | Preserve prompt creation, editing, copying, deletion, and dated version history. An unchanged save creates no additional version. Retain the current title/content validation limits and literal rendering of stored text. |
| FR-005 | Persist model selection, thinking mode, context size, system instruction, and Keep working on the server. Preserve existing defaults and intentionally blank system instructions. Load preferences before chat/settings initialization; page initialization must not overwrite stored values with defaults. Confirm writes only after server acknowledgment; failures retain editable values with an unsaved notice. |
| FR-006 | Prevent silent lost updates across tabs/devices. Conversation, prompt, and preference mutations use server-checked revisions inside transactions. Stale saves/deletions return a conflict and preserve local work. Failed or duplicate submissions must not create duplicate prompt versions or conversations. A deleted record must not be recreated by a stale update. |
| FR-007 | Acknowledged mutations survive ordinary process restart. Each save/delete commits all related records or none. Disk-full, permission, busy-database, malformed-data, and interrupted-write cases produce a clear failure without erasing valid prior data. An unreadable/corrupt existing database must never be silently replaced with an empty one. |
| FR-008 | If loading/saving fails, show a clear server-storage message and allow retry. Keep completed answers and prompt editor text available in the open page for copying. Never report failed persistence as saved, trigger another model generation to retry storage, or silently fall back to browser-only persistence. |
| FR-009 | Offer an explicit **Import browser data** action with a shared-storage disclosure. Read only the current origin/profile's legacy IndexedDB and localStorage. Support chat schemas 1 and 2 and legacy non-UUID IDs; validate and map IDs safely. Preserve prompt versions and dates. Import incrementally with per-record outcomes; retries must not duplicate data or overwrite divergent server records. Conflicts are reported and preserved for explicit resolution. Original browser data remains untouched. Import preferences only through an explicit selection with revision protection. |
| FR-010 | Browsers without IndexedDB/localStorage still support all new storage operations. Legacy storage is accessed only for optional import. Explain that other origins, profiles, and devices must each run their own import; the server cannot discover their browser data. |
| FR-011 | Validate every storage request on the server, including record shape, allowed fields, references, IDs, revisions, preference values, and byte/count limits. Use SQL parameters; clients cannot select filesystem paths. Explicitly bound request bodies, attachment writes, and aggregate records, and reject oversized input clearly without mutation. Final limits must account for existing attachment support and be documented before implementation. |
| FR-012 | New storage routes must not inherit wildcard CORS. Require same-origin browser access, validate mutation Origin and a required non-simple application header, enforce declared content types and allowed methods, reject cross-origin preflights, and prevent caching of sensitive API responses. Keep database files inaccessible to static HTTP routes and exclude payloads from logs. These measures do not provide authentication: trusted clients reaching the service can access the shared store. |
| FR-013 | Linux installation/update preserves destination data, excludes source-checkout data from the installation archive, and grants the service account write access only to the data directory and required existing runtime files. Database/journal files stay out of Git. Tests use isolated temporary stores and never open the user's live database. |
| FR-014 | Provide a documented backup/restore procedure: stop the service, copy the entire data directory, restore with correct ownership, and restart. Validate restores before accepting writes. Do not promise forensic erasure or encrypted storage. Schema upgrades must be versioned, transactional, and preceded by a verified backup. |

## Verification and release acceptance

- Restart and second-browser tests demonstrate shared chat/prompt/preference persistence; clearing browser storage does not remove server records.
- Tests cover full attachment round trips, text-only legacy chats, mixed models, blank instructions, prompt history/no-op saves, deletion, stale edits/deletes, duplicate retries, and import retries/conflicts.
- Fault tests cover failed commits, permission/disk errors, busy access, interrupted process/restart, corrupt databases, and retry without another inference request.
- Security tests cover invalid shapes/IDs/references, traversal strings, body limits, cross-origin reads/writes/preflights, direct database URL attempts, and sensitive-response caching/logging.
- Synthetic large-attachment measurements establish bounded startup/listing behavior and ensure text-only updates do not rewrite attachment payloads. No real PDF batch processing or GPU inference is needed.
- Verify Linux update/ownership behavior and backup restoration in a disposable environment; report if that environment is unavailable.
- Run focused tests, the full practical suite, the modified-code comment pass, then repeat relevant checks. Update README storage/shared-access/import/backup/operations guidance.

## Resolved implementation decisions

- Single shared installation includes chats, prompt versions, and all five preferences. No accounts or separate per-browser durable store.
- User explicitly approved Node 24 and built-in SQLite. Minimum tested runtime is Node 24.14.1; no driver/package dependency was added.
- Chunks contain 4 MiB of encoded image text; encoded images are limited to 64 MiB, all encoded chat attachments to 2 GiB, and metadata/prompt-library requests to 64 MiB. These are enforced ceilings, not tested capacity guarantees. A synthetic 40 MiB rendered-image payload was round-tripped without GPU/PDF work.
- Explicit `HYPERMANIA_ORIGIN` supports TLS-terminating proxies; untrusted forwarded headers are ignored.
- Browser import is opt-in, incremental, conflict-aware, and non-destructive. Server schema version 1 has no upgrade from a previous server schema.
