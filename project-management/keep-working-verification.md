# Keep working — verification evidence

## Isolated browser verification

Parent ran headless Edge against a static server with all `/api/**` intercepted; no live backend, GPU, PDF processing, or inference. At 1149×773 and 390×844 verified default-on option; off/on persistence across reload; one mock job creation; disabled busy policy and enabled Stop; keyboard Enter Stop; exact whitespace draft restoration; removal of partial answer; neutral Stopped status without error; unlocked controls; zero page errors and no horizontal overflow. Visible message area heights: 273.75px and 140.75px. Stop height: 45px at both sizes. Parent visually inspected both running screenshots and reported consistent theme.

Evidence directory: `C:\Users\Joey\.codex\visualizations\2026\10\29\01a18632-bab7-79f1-894a-60a6f3ce86d2`.
Screenshots: `keep-working-1149-running.png`, `keep-working-1149-stopped.png`, `keep-working-390-running.png`, `keep-working-390-stopped.png`. Harness is in the same directory.

## Backend focused checks

`node --test test/chat-job-lifecycle.test.js test/server.test.js`: 35/35 passed after final comment/race pass. Includes simulated 62 minutes before headers and streaming, exact legacy deadline and omission compatibility, local mock upstream disconnection before headers and midstream, duplicate-create recovery, conflicting reuse/options filtering, late chunks, early cancel before runner startup, response cap abort, retention/capacity pruning. `node --check server.js` passed.

## Frontend and combined final checks

Frontend worker ran `node --check public/app.js`, `npm run build:styles`, and final `npm test`: all passed after modified-code comment/format review. Dedicated frontend lifecycle tests cover prolonged outages, creation identity recovery, early/offline Stop, completion races, follow-up cancellation, capacity rejection, and true failures. Preference and send tests cover storage fallback and canceled-draft recovery/follow-up suppression.

Manager independently ran `npm test` after final edits: **114 tests passed, zero failed/skipped/canceled**. `git diff --check` passed, with only Git's Windows LF/CRLF notices. No dependency files changed.

Parent reran the isolated browser harness after all final frontend edits at both sizes. All prior assertions passed again; an added assertion confirmed focus returns to the recovered prompt after Stop. Screenshots in the evidence directory were refreshed.

## Restrictions and remaining checks

No real PDF upload or real model inference was performed, per user instruction. Independent consultant gate is in progress; real Ollama honoring disconnect remains a documented external dependency, not inferred from local mock transport tests.

## Required review remediation and final quick checks

The first independent report is preserved verbatim in keep-working-independent-review-1.md. Backend remediation replaces arbitrary lifecycle exception/error-body logging with safe classifications and numeric upstream status. Added synthetic private prompt/file/answer HTTP-body and stream-exception regressions. Backend focused suite after comments: 37/37 passed.

Frontend remediation adds visible `#responseNotice` after confirmed cancellation and clears it on next send. Behavior assertions verify both transitions. Final full suite after both fixes and comment pass: **116/116 passed**. Syntax and Sass compilation passed; final manager whitespace check passed.

Parent's final isolated Edge QA took approximately 4.85 seconds and passed at both sizes: visible neutral stopped notice, clearing on next send, exact draft restoration/focus, no error banner, and prior controls/layout assertions. Parent visually inspected the refreshed mobile stopped screenshot and confirmed readable neutral text above the draft. Screenshots/harness remain at the same paths. No long-running real-time test, live backend or GPU used.

Fresh second independent gate in progress, without prior report or management assessments supplied to reviewer.

## Second review remediation and final source verification

The second independent report is preserved verbatim in keep-working-independent-review-2.md. Frontend owner comprehensively removed model-originated streaming diagnostics from lifecycle logs: normal/trailing NDJSON errors use fixed diagnostics; send_error logs fixed request_failed reason. Added actual sendChat → debugLog → /api/log synthetic sentinel assertions for newline/trailing error objects and arbitrary thrown errors.

Visible active status now remains in responseNotice after the first token and in followups. Successful follow-up reconnection restores its active-stage label without relying on a generation monitor. Added DOM/state and actual follow-up recovery regressions. After modified-code comment pass: app syntax check and style build passed; final **npm test 118/118 passed**. Final manager `git diff --check` passed (line-ending notices only).

Parent's final isolated outage QA passed at 1149×773 and 390×844 in approximately six seconds: after first token a simulated outage displays Reconnecting visibly; keyboard Stop while offline displays exact pending reconnect text and stays busy; reconnection confirms cancellation with restored draft/focus/visible stopped notice; next send replaces notice with active status. No page errors or horizontal overflow. Message area remains 241.59px/108.59px. Parent visually inspected the readable mobile pending-stop screenshot. Added `keep-working-1149-pending-stop.png` and `keep-working-390-pending-stop.png`; remaining screenshots refreshed at same evidence path.

No live backend, model inference, real PDF upload, GPU or elapsed-time soak used. Fresh third independent review in progress; previous reports/management assessments not supplied.

## Final independent gate

Fresh independent reviewer returned **PASS**, with no findings or required remediation. Report preserved verbatim in keep-working-independent-review-3.md; previous reports remain intact. Reviewer mapped all FR-001–FR-010, independently ran 88 quick pure tests and three syntax checks, and inspected source/integration tests and all six desktop/mobile screenshots. Read-only restrictions prevented repeating integration/full suite/Sass build; those checks were completed by implementation owners/manager as documented above. No open issues within approved scope.
