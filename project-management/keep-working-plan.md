# Keep working — implementation plan

Status: Approved by the user on 2026-10-29: “Approve—implement the plan”. RODES confirmed.

## P-01 — Outcome and approved discovery

The user is product owner. The project manager coordinates scoped backend and frontend developers and a fresh independent consultant. A complex PDF/model request must be able to run beyond an hour without Hypermania abandoning it merely because time passed. The user approved a visible, remembered **Keep working** option enabled by default; disabling it retains the existing 30-minute limit. **Stop** cancels the current model request, discards its unfinished answer, and restores the exact submitted draft and pending attachments for retry.

The user additionally requires Hypermania to retain the attempt and collect/display the response while Ollama continues working. Temporary browser/network disconnection must therefore preserve the active attempt and reconnect to the same job, rather than roll back after the current 30-second visible retry window. Background-tab recovery remains supported.

## P-02 — Architecture and root cause

`server.js` owns recoverable response jobs and their Ollama streams. `runChatJob` unconditionally aborts at 30 minutes. Its transport already supports cancellation through an AbortSignal that destroys the individual HTTP request/response. `public/app.js` starts jobs and polls immutable character offsets, but gives up after 30 seconds of visible network disconnection. Follow-up polishing/fallback currently uses a separate direct request and must share the cancellable job lifecycle. Preferences use the existing localStorage helper; no dependency is required.

## P-03 — Shared contract

1. Job creation accepts an optional boolean `keepWorking` application option, removes it before forwarding the model payload, and defaults to the legacy deadline when omitted for compatibility. The UI explicitly sends its selected policy for every generation stage.
2. `POST /api/chat/jobs/:id/cancel` cancels only that job's transport. Cancellation is an idempotent terminal transition; already finished jobs are not rewritten. Polling returns a distinguishable `canceled` status. Timer expiry remains `failed` with the legacy timeout message. Actual transport/model failures remain errors.
3. Preserve a stable active job ID and offset across transient polling failures. Continue bounded-interval reconnect attempts without a total reconnect deadline while the attempt remains unresolved; do not launch duplicate inference or discard its draft, attachments, or partial UI. Stop requested offline remains visibly pending and retries cancellation on reconnection, rather than falsely claiming the backend stopped.
4. Cover a lost creation acknowledgment without silently launching a second job: each generation stage supplies an optional UUID `jobId` in the creation JSON. Repeating the same ID and normalized model request returns the existing job, without inference duplication; conflicting reuse is rejected. Strip `jobId` before forwarding to Ollama. Existing clients may omit it and receive a server UUID. A stop requested before creation acknowledgment waits for recovery of that acknowledgment and then cancels the same job.

## P-04 — Backend work

Make the deadline conditional per job. Store the job's cancellation handle and distinguish user cancellation, deadline expiry, successful completion, and genuine errors. Release timers/listeners/readers on terminal paths. Keep collecting response chunks while the browser is disconnected. Preserve running jobs during pruning, retain completed results for the existing six hours, and retain existing 50-job and eight-million-character caps. Provide no global Ollama shutdown and log only safe lifecycle metadata.

## P-05 — Frontend work

Add a labeled Keep working checkbox beside Send and persist it through `public/preferences.js`, defaulting on even when storage is unavailable. Lock the chosen policy for the active send. Add an accessible Stop control for active model work, with clear stopping/reconnecting states. Keep navigation and draft mutation locked until the attempt resolves. Use the same cancellable recoverable job lifecycle for main generation, no-answer retry, and polishing while preserving their existing presentation rules.

On confirmed cancellation, roll back provisional conversation state, remove unfinished response UI, restore the exact draft and pending files, and show a neutral stopped status without a failure banner. Prevent late output from saving or beginning a follow-up after Stop. If cancellation races successful completion, honor the authoritative terminal state and never claim to cancel an already completed job. Existing true-error recovery and successful persistence remain intact.

## P-06 — Verification and documentation

Use Node tests, synthetic browser state, mocked clocks, and local mock Ollama/PDF services only. No real PDF upload, real inference, or GPU work. Verify simulated elapsed times beyond 30 and 60 minutes, legacy expiry, cancellation before headers/first token and during chunks/follow-ups, late/duplicate Stop, stopped draft/files recovery, prolonged foreground polling outage, background recovery, lost creation acknowledgment, and genuine failures. Verify options are stripped from Ollama payloads and caps/retention are preserved. Run focused tests per logical change, stylesheet compilation if styles change, practical full suite, and modified-code comment review followed by relevant checks again. Check the controls at desktop/mobile sizes with an isolated static/mock page where available; record unavailable checks honestly. Update README behavior and limits. No dependencies or dependency-file changes.

## P-07 — Ownership and sequence

- T-01 backend developer: `server.js`, `test/server.test.js`, and one narrowly scoped job lifecycle test file/helper only if necessary. Satisfies FR-002–FR-006 and FR-008–FR-009. First establish the shared contract with the manager; report exact fields before frontend implementation.
- T-02 frontend developer: `public/app.js`, `public/index.html`, `public/preferences.js`, `public/style.scss`, generated `public/style.css`, `test/preferences.test.js`, relevant generation/attachment/surface tests, a dedicated keep-working behavior test if needed, and README. Satisfies FR-001–FR-005 and FR-007–FR-010. Depends on T-01 interface agreement, then can run alongside backend implementation without shared-file ownership.
- T-03 manager: task briefs/status and scope decisions under `project-management/`; verify requirements and evidence; route focused fixes to owners.
- T-04 fresh read-only consultant: independently map all FRs to code/tests and assess quality, security, coverage, scope, and undocumented decisions. Do not read task briefs, status, prior reviews, or agent reasoning. Preserve and present report verbatim. Only PASS completes the gate; remediate and request a fresh review otherwise.

Existing attachment-task modifications and its root plan/requirements are preserved. Workers are not alone and must not revert others' edits.

## P-08 — Boundaries and remaining limits

This fixes the active request lifecycle and temporary disconnection in the existing page. It does not add durable cross-restart jobs, page-reload/tab-close session restoration, an arbitrary abandoned-job browser, a distributed queue, PDF-processing redesign, or changed memory limits. The previously failed response cannot be reattached. Hypermania disconnects the individual model stream when asked to stop; Ollama must honor that disconnect. Real backend/model/network failures and resource limits can still terminate work and must be reported clearly. Existing in-memory attempts remain retained server-side according to the stated limits. No unrelated settings, dependency, or architecture changes.

## P-09 — Approval gate

The user confirmed Role, Objective, Details, Examples, and Sense check, then approved these documents: “Approve—implement the plan”. Any material scope or contract conflict is raised with options and recommendation before changing the approved plan.
