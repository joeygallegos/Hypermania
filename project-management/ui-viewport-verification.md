# UI and conversation viewport verification

Date: 2026-10-29. Status: implemented and verified in the working tree; not committed or pushed.

Requirements: `../ui-functional-requirements.md`. Enhancement source: `../enhancement.md`. The saved-prompt chooser is excluded. Existing duplicate-status corrections were preserved. No dependencies or backend files were changed for this work.

## Final browser measurements

CUA browser checks used static local assets with synthetic model discovery, capability, and response APIs. They did not connect to the user's Hypermania/Ollama service. Measurements used a completed synthetic conversation with a long title, thinking-capable model, closed model options, collapsed attachments, and compact empty editor. Each value is the actual `.messages` region height, not total page height.

| Viewport | Baseline | Final | Requirement | Send visible | Horizontal overflow |
| --- | ---: | ---: | ---: | --- | --- |
| 1149 x 773 | 229px | 509px | >= 380px | Yes | None |
| 1149 x 600 | 55px | 368px | >= 220px | Yes | None |
| 390 x 844 | 189px | 488px | >= 320px | Yes | None |
| 844 x 390 | 24px | 158px | >= 120px | Yes | None |

At 1149 x 773, reading mode increased message height to 521px, hid desktop history, and kept Chats accessible. Toggling it restored the ordinary layout without clearing the conversation.

At 320 x 600, the narrow layout had no horizontal overflow. The Attach and Send controls measured approximately 129px and 59px wide after simplifying the Send label; interactive controls retained 44px minimum height. This is a narrow-layout check, not an actual browser-zoom test.

## Interaction checks

- Mobile model controls opened on demand without increasing the permanent header height. Both Close and Escape in the capabilities dialog restored focus to its visible information button, with the parent options still open. Escape then closed the options disclosure.
- A 30-line synthetic draft remained internally scrollable at 140px. Expand increased it to 320px at 390 x 844; Send remained within the visible chat. Collapse retained the exact draft.
- Reading mode and opening/closing history retained the draft. The history dialog accepted Escape and returned focus to Chats.
- The compact Menu exposed Settings and prompts. The Settings link used an explicit separate-tab target; clicking it did not replace or clear the original chat. A separately opened same-origin Settings tab verified preference synchronization: changing context to 16k updated the original chat while preserving its draft.
- Settings showed Unsaved changes while editing the instruction; Save instruction returned it to Saved and disabled the save button. The new context guidance and connection-lifetime explanation were visible.
- Synthetic empty-model and unavailable-endpoint pages visibly explained the problem. Send stayed disabled even with a draft. Retry recovered an installed model and enabled Send without changing the draft; no invented fallback model appeared.
- A held synthetic response verified pre-token waiting with no duplicate composer notice. During generation, Send was hidden and Stop was visible within the mobile viewport. Keyboard Enter on Stop canceled the mock job, restored the exact whitespace-preserving draft, showed neutral stopped feedback, and returned focus to the editor.
- A synthetic generation failure at 844 x 390 preserved the draft and showed a bounded error area. The exceptional error layout used the chat's scrolling fallback; keyboard navigation into the composer scrolled it into view with Send visible, rather than clipping it permanently.
- Expanded empty attachment controls at 390 x 844 left approximately 334px of conversation space. The existing synthetic eleven-PDF ingestion and mutation-lock regressions also passed; real file uploads were not used.
- The request-help disclosure visibly explained Keep working and Enter/Shift+Enter on a 320px-wide viewport and closed with Escape.
- Desktop and mobile screenshots were visually inspected in the session. Browser viewport overrides and temporary review tabs were restored/closed after verification.

## Requirement traceability

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| UI-FR-01 | Separate Settings target, existing draft confirmations, beforeunload protection, storage synchronization, per-send system-instruction snapshot | Navigation-protection, deferred-settings, and instruction-snapshot tests; same-origin Settings browser check |
| UI-FR-02 | Bounded auto-sizing editor and Expand/Collapse | Composer test; 30-line browser draft check |
| UI-FR-03 | Send/Stop visibility and compact responsive toolbar | Action assertions in attachment tests; held-response keyboard Stop check |
| UI-FR-04 | Title grid, model disclosure, existing capability modal and external warnings | Four viewport checks; mobile disclosure and modal focus checks |
| UI-FR-05 | Dedicated chat viewport allocation, short-height rules, scroll fallback | Measurement table and constrained error check |
| UI-FR-06 | Reversible Read toggle and reusable history dialog | Desktop reading-mode measurements; mobile draft/history preservation |
| UI-FR-07 | Normal-weight prose, conditional per-chunk following, Latest action | Actual text-renderer scroll regression; visual inspection |
| UI-FR-08 | Settings groups, plain guidance, dirty/saved state and unload guard | Settings unit test and browser edit/save check |
| UI-FR-09 | Accessible request-help disclosure and preserved single visible status | Help/keyboard browser checks; generation and lifecycle regression suites |
| UI-FR-10 | Explicit readiness state, no fictional model, guarded Send, Retry | Discovery unit tests and two isolated failure/retry browser checks |
| UI-FR-11 | Compiled CSS, documentation, focused/full tests and modified-code comment pass | Checks below; limitations explicitly recorded |

## Final automated checks

- `npm test`: **126/126 passed**, zero failures or skips. Includes mocked retained-job, cancellation, connection-recovery, document-context, attachment, math, and preference regressions.
- `npm run build:styles`: passed; tracked CSS rebuilt after the comment pass.
- `node --check public/app.js`: passed.
- `node --check public/settings.js`: passed.
- `git diff --check`: passed; Git printed line-ending notices only.
- Dependency files unchanged; dependency security checks were not applicable.

The focused read-only UI critic returned **PASS** after reviewing corrections for modal focus, per-chunk scroll following, and stable system instructions across generation stages. The critic reviewed source; the browser and full-suite evidence above belongs to the primary agent.

## Limits

No real GPU/model inference, large PDF workload, or real PDF uploads ran. Minutes/hours in existing lifecycle tests use simulated clocks. Browser checks did not exercise an actual phone keyboard, real browser-chrome expansion, actual browser zoom, or all device-specific safe areas. The visualViewport path and scrolling fallback are implemented, but those real-device cases need confirmation before claiming device-wide support.

This work does not add durable page-reload or server-restart request recovery, change PDF/model behavior, or add a saved-prompt chooser. The running user service was not restarted.
