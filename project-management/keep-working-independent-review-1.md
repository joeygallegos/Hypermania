Independent consultant report — Keep working implementation

Verdict: CONDITIONAL PASS

The core lifecycle implementation is coherent, and all 34 tests run during this review passed. Two requirements remain incomplete: lifecycle error logs can contain upstream private text, and cancellation confirmation is unavailable visually. These findings prevent a PASS.

Findings, ranked by severity

1. Medium — Upstream error bodies can enter lifecycle logs  
   Requirement: FR-006. Location: `server.js:778`, `server.js:815`, `server.js:836`.

   For an unsuccessful upstream response, `runChatJob` reads the response body and uses it as an Error message. `errorDiagnostic` bounds that text and removes control characters, but does not exclude prompts, filenames, or model output. The job’s `finished` event then logs the resulting `errorDetails`.

   I reproduced this without network activity or filesystem writes by running the actual lifecycle code with a mocked unsuccessful response containing synthetic private-text sentinels. The emitted event included:

   ```json
   {"source":"chat_job","event":"finished","jobId":"synthetic","status":"failed","chars":0,"error":"Upstream failure: private-prompt-sentinel private-file.pdf private-answer-sentinel"}
   ```

   This behavior predates part of the change, but the approved lifecycle requirement explicitly prohibits these contents in logs.

   Recommended remediation: Log allowlisted failure classifications and safe status metadata for upstream HTTP failures rather than the response body. Add a regression test using an upstream error body containing synthetic prompt, filename, and answer sentinels; assert none reach lifecycle logs.

2. Medium — Confirmed cancellation has no visible neutral confirmation  
   Requirement: FR-007; plan P-05. Location: `public/app.js:2216`, `public/index.html:85`.

   The cancellation branch removes the provisional messages and sets “Stopped. Your message and attachments are ready to send again.” through the generation-status mechanism. Its remaining destination is `#status`, which has `class="visually-hidden"`. The assistant’s visible status mirror has already been removed.

   The supplied stopped screenshots at both widths confirm that the draft returns and Stop disappears, but no stopped confirmation is visible. Screen-reader users receive a live-region update; sighted users receive only the changed interface.

   Recommended remediation: Provide a concise visible neutral confirmation after confirmed cancellation, retaining the live-region announcement and avoiding a failure banner. Verify it at desktop/mobile sizes and ensure the next send clears or replaces it.

Requirement traceability

| Requirement | Implementation evidence | Test or inspection evidence | Assessment |
|---|---|---|---|
| FR-001 | Checkbox in `public/index.html`; preference accessors in `public/preferences.js`; `sendChat` snapshots policy into `activeKeepWorking` | Preference default/persistence/storage-failure test; lifecycle request-policy assertions | Covered |
| FR-002 | Conditional deadline in `runChatJob`; follow-ups use `streamChat`; reconnect loop has no total deadline | Lifecycle tests advance beyond 30 and 60 minutes before headers and during streaming; prolonged foreground/background outage test | Covered |
| FR-003 | Missing/false policy retains timer; `keepWorking` and `jobId` removed before model serialization | Exact 30-minute tests for false/undefined; server integration test inspects wire payload | Covered; integration test inspected, not rerun |
| FR-004 | Request-specific AbortController; synchronous canceled transition; idempotent endpoint; late-read guard; Stop UI | Early Stop, buffered late output, duplicate Stop, completion race, offline Stop and follow-up cancellation tests; upstream disconnect integration tests inspected | Covered |
| FR-005 | Stable stage ID and serialized create body; fingerprint-based recovery; immutable polling offset; pending offline Stop | Lost acknowledgment, preserved offset across outages beyond an hour, background recovery and cancellation retry tests | Covered within documented retention bounds |
| FR-006 | Running-job pruning exclusion; unchanged caps/retention; timer/reader/controller cleanup | Retention/cap tests passed; transport cleanup inspected; synthetic upstream-error logging reproduction | Incomplete: finding 1 |
| FR-007 | Exact draft capture; history/document rollback; pending files retained; canceled answer not persisted; focus restored | Mocked send cancellation/error/success test passed; stopped screenshots inspected | Incomplete: finding 2 |
| FR-008 | `fetchChatOnce` delegates to retained stream lifecycle; polishing preserves `mode: "none"`; explicit failed/missing-job handling | Follow-up cancellation and ordinary-failure tests passed; polishing/document-context code inspected | Covered |
| FR-009 | Synthetic clock, VM/DOM harnesses, mock upstream integration tests | 34 focused tests passed; syntax checks passed; no real inference or PDF upload performed | Substantial coverage; broader verification limits below |
| FR-010 | README documents policy, Stop, reconnect, bounds and restart/reload limitations; focused source/style changes | Dependency files unchanged; compiled CSS contains matching added rules; four responsive screenshots inspected | Pending remediation and independent PASS |

Correctness and races

The backend publishes cancellation before aborting transport and checks cancellation before accepting buffered reads. These choices prevent canceled jobs from being resurrected by late output. Completed jobs remain authoritative when completion wins the race.

Creation recovery reuses the same stage ID and request body, avoiding duplicate inference while that job remains retained. Capacity handling looks up an existing ID before reserving space. Poll retries preserve offsets, and offline Stop remains pending until the server provides an outcome.

Follow-up requests share the same transport and cancellation lifecycle. The guard before starting a no-answer follow-up prevents a pending Stop from launching another generation.

Code quality and maintainability

The changes reuse the existing preferences, retained-job infrastructure, transport helper and rollback paths. No new dependency or framework was introduced. Comments explain significant race and ownership decisions. The focused VM tests exercise real function bodies, although source-slice extraction remains sensitive to future function reorganization.

Security and scope

The principal identified privacy issue is finding 1. Job options are validated and stripped before forwarding, job identity uses UUID validation, and fingerprints avoid retaining another full prompt copy.

The application’s existing unauthenticated, cross-origin-accessible trusted-network deployment model remains documented. I found no unrelated dependency changes or material scope drift in the reviewed diff. Restart/reload restoration remains explicitly excluded.

Verification performed

- Read the approved keep-working plan and all ten functional requirements.
- Reviewed relevant source diffs, retained-job transport, cancellation, rollback, preferences, styles, README and tests.
- Ran 34 focused tests: 34 passed, zero failed.
- Ran syntax checks for `server.js`, `public/app.js` and `public/preferences.js`: passed.
- Independently reproduced the log-content issue using synthetic in-memory mocks.
- Inspected desktop/mobile running and stopped screenshots.
- Made no filesystem changes and performed no real model inference, PDF upload or GPU work.

Verification unavailable under the read-only instructions

I did not rerun server integration tests or the full suite because their setup writes temporary files and logs. I inspected the relevant integration tests instead. I did not rerun Sass compilation because it writes generated files, inspect management verification/status artifacts, or independently repeat interactive browser testing.

Required next step: address both findings, add focused regression coverage, and obtain a fresh independent review.
