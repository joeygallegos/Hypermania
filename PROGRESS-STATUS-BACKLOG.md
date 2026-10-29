# Progress status requirements and task queue

Date: 2026-10-29
Status: baseline approved and implemented; optional follow-ups remain queued.

## Objective and scope

Help chat users understand the last observed activity during long responses without inventing Ollama progress. Baseline scope is browser status presentation, lifecycle handling, regression coverage, and user documentation. No new dependencies or changes to model prompts are planned.

The requesting user sets product priorities and approved baseline implementation. Preserve existing polling intervals, idle thresholds, generation limits, response retention, and PDF processing behavior.

## Evidence

- `public/app.js`: `beginGenerationMonitor` replaces status after eight seconds without model text. `touchGeneration` receives thinking/answer phases but uses the same label for both.
- `streamChat` already collects `message.thinking` and `message.content`; healthy job polls can contain no new model text.
- PDF preparation completes before the generation monitor starts. The filename is available as `pdf.name`.
- The model-list health check is not evidence that an individual generation is progressing. The documented Ollama chat stream does not supply detailed live queue, loading, or prompt-processing progress.

## Functional requirements

| ID | Priority | Requirement and acceptance criteria |
| --- | --- | --- |
| FR-01 | P1 | Identify the current PDF during preparation: `Preparing 1234.pdf (1 of 2)…`. Use the actual attachment name and sequence; render names as text, handle long names without breaking layout, and do not add filenames to logs. |
| FR-02 | P1 | Distinguish observed generation phases: waiting before any output, receiving reasoning after a thinking chunk, and receiving answer after a content chunk. Models without thinking output proceed directly from waiting to answer. Do not enable thinking merely for status reporting. |
| FR-03 | P1 | Preserve the last observed phase during idle periods. Before output, show `Waiting for Ollama — no model output yet (8m50s)`. After reasoning, show `Waiting for more reasoning — no new output for 30s`; use equivalent answer wording after answer output. State clearly that elapsed time measures absence of model output. Successful empty polls do not reset that timer. |
| FR-04 | P1 | Keep recovery and lifecycle labels accurate. Reconnection, connectivity failures, retry/polishing, saving, completion, and failure must not be overwritten by a stale generation timer. Reset phase/time state for every send and clear it on terminal paths; late work from a prior request must not affect the next request. |
| FR-05 | P1 | Keep visible status and existing accessible status announcements consistent. Use the existing status mechanism, avoid unnecessary announcements on unchanged polls, and verify narrow-screen layout. |
| FR-06 | P1 | Describe only observed activity. Do not assert PDF parsing after preparation, exact Ollama loading/queue stages, percentage complete, remaining time, or the cause of silence without evidence. A reachable Ollama endpoint does not prove request progress. |

| FR-07 | P1 | Display elapsed time using compact hours/minutes/seconds: `25s`, `8m50s`, `1h30m25s`. Include hours when applicable; `5000s` displays as `1h23m20s`. Test minute and hour boundaries. |

## Ordered implementation queue

Baseline tasks below are complete. Dependencies record implementation order.

- [x] T-01 (P1): Implement minimal phase and idle-status handling in `public/app.js` using existing helpers. Cover FR-02, FR-03, FR-06, and FR-07. Keep generation state scoped/reset per request and preserve current timing settings. Dependencies: none.
- [x] T-02 (P1): Add filename-aware preparation labels in `public/app.js`. Cover FR-01 with safe text rendering and bounded visual presentation. Dependencies: none.
- [x] T-03 (P1): Integrate status precedence and lifecycle cleanup with reconnect, fallback, saving, error, and subsequent-send paths. Cover FR-04 and FR-05 without changing recovery policy. Dependencies: T-01.
- [x] T-04 (P1): Add behavioral regression coverage using the existing Node test tools and controlled clock/network responses. Verify initial silence, thinking then answer, no-thinking models, idle after either phase, empty successful polls, failed polls/reconnect, fallback/polishing, terminal cleanup, and consecutive requests. Include multiple/long/unusual PDF names. Dependencies: T-01 through T-03.
- [x] T-05 (P1): Verify status layout and accessible announcements in a browser, update README with status meanings and visibility limits, and review comments only in modified code. Run relevant tests and `npm test`; report unavailable checks explicitly. Dependencies: T-04.

## Optional follow-up queue

- [ ] O-01 (P2): Design an opt-in expandable live reasoning view using thinking output already received. Label it as model-generated text; define persistence, accessibility, and rendering limits before implementing. This is separate from baseline stage labels.
- [ ] O-02 (P3): Investigate server-reported PDF substages such as inspecting, extracting text, and rendering pages. Requires a backend progress contract and reconnect/error behavior; prepare a separate scoped proposal before implementation.
- [ ] O-03 (P3): Investigate request-specific Ollama telemetry if supported by the deployed version. Verify actual signals before proposing exact loading, queue, or prompt-processing labels. No log scraping or speculative status text in the baseline.

## Completion gate

Baseline work is complete when FR-01 through FR-07 are verified, T-01 through T-05 are checked with evidence, and the diff contains no unrelated changes. Dependency/security-advisory checks apply only if a separately approved dependency change becomes necessary. README documents status meanings and upstream visibility limits.

## Verification evidence

- `npm test`: 87 tests passed, including 9 progress-status tests with controlled clocks/network responses and actual stream polling.
- `npm run build:styles` and `node --check public/app.js`: passed.
- Browser verification used an isolated local fixture with the actual app functions, DOM, and stylesheet, without model generation or saved chat writes. At 390x844, a long unbroken PDF filename wrapped without horizontal overflow, visible/live labels matched, and only the polite live region was exposed to accessibility. The `1h30m25s` reasoning status fit at mobile and 1149x773 desktop widths.
- Independent read-only consultant review: no actionable defects; consultant independently ran all 9 progress-status tests successfully.
- No dependencies changed. Real Ollama performance and the cause of the earlier 530-second silence were not tested. A hanging health check still has no timeout; elapsed/phase updates continue while it is pending.
