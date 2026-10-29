# Keep working — functional requirements

Status: Approved by the user on 2026-10-29: “Approve—implement the plan”.

## FR-001 — Clear remembered policy

The composer exposes a labeled Keep working option enabled on first use and when storage is unavailable. Explicitly switching it off/on persists across reloads through the existing preferences helper. The active send uses its starting selection throughout its generation stages.

## FR-002 — Long generation without elapsed deadline

With Keep working enabled, simulated main and follow-up generation remain running beyond both 30 and 60 minutes until completion, explicit cancellation, a genuine error, or an existing resource limit. No elapsed generation/reconnect deadline alone abandons the attempt.

## FR-003 — Legacy limited mode

With Keep working disabled, the existing 30-minute model-generation deadline still fails the job with a clear timeout. Missing application policy on existing job clients retains legacy behavior. Application-only options do not reach Ollama.

## FR-004 — Explicit request cancellation

An accessible Stop control cancels the active model request, including pre-token/streaming and follow-up generation. It disconnects only that request. Duplicate Stop is safe; completed jobs are not rewritten; timer cancellation and user cancellation are distinguishable. Late chunks cannot resurrect a canceled job or begin another generation.

## FR-005 — Retain and recover active attempts

During a temporary foreground outage longer than the previous 30-second window or a background suspension, the server keeps collecting output and the page retains the active job identity, offset, draft, attachments, and provisional response. Reconnection retrieves missed output from the same job without duplicate inference. Lost job-creation acknowledgment has a defined recovery path. Stop while disconnected stays visibly pending until cancellation/terminal state is confirmed; the UI does not falsely report a stopped backend.

## FR-006 — Existing safety and retention bounds

Running jobs are not evicted. Existing maximum retained jobs, per-response character cap, and completed retention duration remain unchanged. Terminal lifecycle paths clean up transport/timer resources. Lifecycle logs exclude document contents, prompts, filenames, and model output.

## FR-007 — Canceled-send recovery

On confirmed cancellation, discard the unfinished answer and provisional conversation changes, restore the exact submitted text and pending attachments, unlock the composer, and show a neutral stopped status. Do not show a generic failure banner, save a canceled answer, or automatically retry. Existing successful-send and actual-error behavior remains covered.

## FR-008 — Follow-up consistency and errors

No-answer fallback and polishing respect the same policy, Stop, retention, and reconnect behavior as main generation. Keep their existing answer presentation and document-selection behavior. Genuine model, transport, missing-job, and resource-limit errors remain visible and distinguishable from user cancellation.

## FR-009 — Mocked verification

Cover long elapsed times, timeout-off compatibility, delayed headers/first token, streaming and follow-up cancellation, cancellation races, reconnect recovery, lost create acknowledgment, wire-payload filtering, and ordinary failures using synthetic data/mock services. Run focused and practical full tests and the modified-code comment pass with repeat checks. Perform no real model inference or real PDF uploads.

## FR-010 — Focused delivery and clear limits

Document Keep working, Stop, reconnect behavior, retention/memory bounds, and server-restart/page-reload limitations in README. Add no dependencies. Preserve prior attachment work. Compile styles if changed and check responsive/control accessibility where available. Obtain an independent consultant PASS with requirement traceability and disclose any unavailable verification.
