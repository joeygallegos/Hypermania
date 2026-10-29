# Independent consultant report

**Verdict: CONDITIONAL PASS**

The core job lifecycle is implemented coherently, and all 35 quick unit tests executed during this review passed. Two medium-severity gaps require remediation before the final gate passes.

## Findings

### 1. Medium — Streaming model errors can enter lifecycle logs unchanged

**Locations:** `public/app.js`, `streamChat()` error parsing and `sendChat()` catch handler; `server.js`, `handleLog()`.

HTTP error bodies and transport exceptions are now excluded from backend lifecycle diagnostics. However, an Ollama NDJSON object containing `{"error":"…"}` follows another path:

1. `streamChat()` passes the upstream error text into `publicError()`.
2. `sendChat()` extracts that text into `diagnostic`.
3. `debugLog("send_error", { message: diagnostic })` sends it to `/api/log`.
4. `handleLog()` writes the supplied message.

A read-only VM probe confirmed that a synthetic private sentinel in a streaming error reaches the exception diagnostic unchanged. Source inspection establishes its subsequent logging path.

An upstream error could echo a prompt, filename, or answer. This leaves the privacy requirement incomplete, including for follow-ups now using this stream parser.

**Requirements affected:** FR-006, FR-008, FR-009.

**Recommended remediation:** Use a fixed, safe diagnostic identifier for upstream streaming errors before logging. Preserve a clear public error and request reference. Add a synthetic NDJSON error test asserting that private sentinels never reach lifecycle log payloads. Cover both newline-terminated and trailing error objects.

### 2. Medium — Reconnection status is not consistently visible or reset

**Locations:** `public/index.html:85`; `public/app.js`, `setBusy()`, `streamChat()`, and `fetchChatOnce()`.

The status live region is visually hidden. Before the first answer token, its text is mirrored into the visible pending-message label. Once answer content arrives, that label is removed and `state.assistantWaitLabel` becomes null.

Consequently, a subsequent outage updates only the hidden live region. A sighted user sees partial output and “Waiting...” without the intended reconnect explanation. Offline Stop visibly changes the button to “Stopping…”, but its reconnect explanation is likewise hidden after answer text appears.

Follow-ups have another state issue: `sendChat()` stops the generation monitor before starting fallback or polishing. Successful follow-up polls reset reconnect status only inside an `if (state.generationSession)` branch. That session is absent. A read-only VM probe reproduced a recovered, successfully completed follow-up whose only supplied status label remained “Reconnecting to response…”.

The supplied desktop/mobile screenshots show usable controls and a clear stopped notice, but do not establish correct reconnect presentation.

**Requirements affected:** FR-005, FR-008; plan P-05’s clear stopping/reconnecting states.

**Recommended remediation:** Provide a visible status surface throughout active generation, including after partial output and during follow-ups. Restore the appropriate active-stage label after a successful reconnect independently of the generation monitor. Add DOM/state coverage for reconnect after the first token and recovery during fallback/polishing.

## Requirement traceability

| Requirement | Implementation | Verification and assessment |
|---|---|---|
| FR-001 | Keep working checkbox; preference getter/setter; `activeKeepWorking` submission snapshot | Preference tests cover defaults, both choices, and unavailable storage. Source confirms stage policy reuse. Satisfied. |
| FR-002 | Conditional timer in `runChatJob()`; shared follow-up transport | Lifecycle tests simulate 31 and 62 minutes before headers and during streaming. Follow-up transport test verifies shared lifecycle. Satisfied within simulated verification. |
| FR-003 | Missing/false policy retains timeout; application fields removed before forwarding | Exact deadline tests passed. HTTP integration test source checks payload filtering. Satisfied by source and available tests; HTTP suite not rerun. |
| FR-004 | Idempotent cancel endpoint; per-job controller; cancellation checks before publishing chunks | Pure tests cover early Stop, late output, duplicate intent, and completion races. HTTP test source checks pre-header/stream cancellation and isolation. Satisfied within stated verification limits. |
| FR-005 | Stable stage ID/body; immutable offsets; indefinite bounded-interval retry; pending cancellation | Recovery tests passed for prolonged outages, lost acknowledgment, and offline Stop. Visible status gap remains: finding 2. |
| FR-006 | Existing pruning/caps; terminal cleanup; allowlisted backend diagnostics | Retention, resource-limit, and exception-privacy unit tests passed. Streaming-error log path remains: finding 1. |
| FR-007 | Provisional history/document rollback; exact draft restoration; retained pending files; neutral notice; focus restoration | Attachment/send test passed for cancellation without persistence or error banner. Desktop/mobile stopped screenshots corroborate visible recovery. Satisfied. |
| FR-008 | `fetchChatOnce()` delegates to retained streaming jobs; polishing excludes document reattachment | Follow-up cancellation/contract tests passed. Error logging and reconnect presentation remain incomplete: findings 1–2. |
| FR-009 | Mocked clocks, VM/DOM tests, synthetic services and failure fixtures | 35 focused tests passed. Missing streaming-error privacy and recovered follow-up status assertions should accompany fixes. Full-suite/comment-pass history was deliberately not consulted. |
| FR-010 | README documents policy, Stop, reconnect, bounds, and restart/reload exclusions; stylesheet additions | No dependency changes observed. Responsive screenshots inspected. Style compilation and broader checks were not independently executed. Independent PASS remains pending remediation. |

## Quality, security, and scope assessment

The changes reuse the existing transport and preferences architecture without adding dependencies. Stable stage IDs, fixed-size request fingerprints, synchronous cancellation transitions, and checks against late buffered reads are appropriate for the approved scope.

Lifecycle logs now use safe backend failure categories and numeric upstream status. Finding 1 identifies the remaining browser-originated diagnostic path.

The reviewed diff remains focused on the approved feature and related tests/documentation. No additional material scope drift or undocumented architecture decision was identified. Existing trusted-network security limitations are documented; this review does not establish safety for public exposure.

## Verification performed

- Executed **35 tests: 35 passed, 0 failed** across lifecycle, Keep working, preferences, generation status, and attachment suites.
- Passed syntax checks for `server.js` and `public/app.js`.
- Passed `git diff --check`; Git emitted line-ending warnings.
- Ran two short, read-only VM probes confirming the findings.
- Inspected four supplied desktop/mobile running/stopped screenshots.
- Reviewed relevant HTTP integration test source.

No files were written. No dependencies were installed. No real inference, GPU work, PDF uploads, or elapsed-time soak tests were performed.

The HTTP integration suite was not executed because its setup writes temporary files/logs. Styles were not rebuilt because that writes generated artifacts. Screen-reader operation and real Ollama disconnect behavior were not independently exercised.

**Required next step:** Address both findings with focused regression tests, then obtain a fresh independent review.
