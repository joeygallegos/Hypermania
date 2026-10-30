# UI and conversation viewport — functional requirements

Status: implemented in the working tree on 2026-10-29; verification and limitations are recorded in `project-management/ui-viewport-verification.md`. Source: `enhancement.md` (EH-01 through EH-09). The saved-prompt chooser remains excluded. Preserve the existing terminal theme, attachment behavior, and generation lifecycle; add no dependencies.

## UI-FR-01 — Preserve the chat while configuring it (EH-01)

Settings opens in an explicitly labeled separate tab, leaving the draft, pending attachments, scroll position, and active generation in the original page. Closing/reloading/navigating away warns when a draft, pending files, or active request would be abandoned. Existing internal draft-discard confirmations remain. Preferences changed in Settings apply to subsequent sends without reloading the chat; active request policy remains fixed. This does not add cross-reload or server-restart recovery.

## UI-FR-02 — Compact, bounded message editing (EH-02)

An empty composer starts at one line and grows with input/paste up to a viewport-relative bound, then scrolls internally. An accessible Expand/Collapse action supports longer editing; sending/resetting returns it to compact mode and cancellation/failure restores the exact draft with usable sizing. Long drafts must not clip Send/Stop.

## UI-FR-03 — One primary request action (EH-02)

Send is available when idle and usable; Stop replaces it during active model generation, retaining pending-stop semantics. During preparation/saving, show the disabled busy action only when Stop cannot apply. Attachments/options share a compact responsive toolbar, retaining 44px interactive targets and busy inspection/mutation rules.

## UI-FR-04 — Compact conversation header (EH-03)

The title truncates inside its own column without colliding with Chats. A compact model summary opens an accessible on-demand panel containing the existing model, thinking, capability, and model-warning controls. Full title/model values remain available. Model changes preserve existing context and attribution behavior.

## UI-FR-05 — Reading space and short-viewports (EH-04/EH-05)

Allocate the chat from remaining layout height with dynamic-viewport fallbacks rather than guessed fixed-header subtraction. Provide a height-sensitive layout and scrolling fallback so controls never become clipped. Tighten non-content padding without reducing answer font size or touch targets. With collapsed attachments, compact empty composer, and model options closed, target message heights of at least 380px at 1149x773, 220px at 1149x600, 320px at 390x844, and 120px at 844x390. Verify Send/Stop accessibility at each size. Real phone keyboard/browser-chrome behavior must be reported separately if unavailable.

## UI-FR-06 — Reversible reading mode (EH-05)

A labeled Reading mode toggle reduces app chrome and hides desktop chat history to give the response more room. It remains reversible by keyboard/touch; Stop, Settings, model options, and history remain reachable. It must not reset the chat or draft.

## UI-FR-07 — Readable answers and stable reading position (EH-06)

Use normal-weight response prose with bold reserved for semantic emphasis, preserving monospace branding/code and readable line spacing. Reduce competing nested decoration. Streaming follows output only when the user is near the bottom; otherwise preserve their reading position and expose a Latest button. Opening a saved chat or sending a new message deliberately returns to the latest response.

## UI-FR-08 — Clear Settings save behavior (EH-07)

Group connection and response preferences. Explain automatic saves and connection lifetime beside the controls. The system instruction shows unsaved/saved feedback and warns before discarding unsaved edits. Context guidance uses user-facing language. Existing preference values and server endpoint behavior remain unchanged.

## UI-FR-09 — Accessible help and single status (EH-08)

Tap/keyboard-accessible request help explains Keep working, its optional 30-minute limit, and desktop Enter/Shift+Enter shortcuts without a permanent extra row. Associate help with the controls. Preserve the single visible waiting/streaming/reconnect/stopping status and accessible live announcements.

## UI-FR-10 — Honest model readiness (EH-09)

Do not invent an installed model after discovery failure or an empty list. Show Loading, Ollama unavailable, or No models installed visibly, with Retry and Settings as appropriate. Keep drafts and attachments intact. Disable/reject Send until a real discovered model is selected. Successful retry restores readiness; genuine model/network failures remain visible.

## UI-FR-11 — Verification and delivery

Use mocked APIs, clocks, and synthetic data only. Cover readiness failures/retry, draft navigation protection, editor sizing, action visibility, scroll-follow behavior, preference/save feedback, keyboard/focus, and retained generation regressions. Measure viewport geometry in idle, waiting, streaming, reconnecting, pending Stop, error, expanded attachments, long draft, and reading mode; check long titles/tables/code, zoom-like narrow layouts, and both thinking-capable and ordinary models. Build tracked CSS, run focused/full tests, review modified comments, update README, and report unavailable real-device checks honestly. Preserve existing uncommitted duplicate-status changes.
