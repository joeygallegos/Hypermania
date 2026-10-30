# UI/UX enhancements

Reviewed: 2026-10-29. Converted to testable requirements in `ui-functional-requirements.md` and implemented in the working tree. Baseline findings below are retained for comparison; current verification is recorded in `project-management/ui-viewport-verification.md`.

## Goal and scope

Make Hypermania sleeker and more straightforward while preserving its terminal styling, readable answers, accessible controls, and long-running request behavior. The user's primary viewport concern is **not enough vertical room to read a conversation**.

This backlog combines the UI/UX skill review, independent UI critic feedback, and isolated browser exploration of chat, attachments, model details, Settings, and prompt management. Browser checks used synthetic data and mocked APIs; no real PDF uploads or Ollama inference ran. The previously requested duplicate-status correction is separate work already present in the working tree.

## Viewport findings

Measured the scrollable `.messages` region with a completed synthetic answer, a long conversation title, thinking controls visible, attachments collapsed, and the software keyboard closed. These are baseline measurements, not predictions of the proposed layout.

| Viewport | Message-region height | Share of viewport height | Observation |
| --- | ---: | ---: | --- |
| 1149 x 773 | 229px | 30% | The app header is 80px, chat header 127px, and composer 188px. |
| 1149 x 600 | 55px | 9% | The same fixed chrome leaves only a few lines for the conversation. |
| 390 x 844 | 189px | 22% | The composer is 300px, including a 156px action area, even when idle. |
| 844 x 390 | 24px | 6% | The desktop layout applies above the 820px breakpoint; the composer overflows the chat panel and its actions are clipped. |

The visible reading area is the problem, rather than a lack of total page content. On desktop, the page cannot scroll and the chat clips overflow. On mobile, page scrolling and the nested conversation scroller add navigation friction. Increasing the chat's overall minimum height alone would move controls offscreen instead of solving the allocation problem.

## Prioritized enhancements

### EH-01 — Protect the current conversation when opening Settings

**Priority:** High. **Effort:** Low for immediate protection; medium for an in-page panel.

**Observed:** Typing a draft, opening Settings, and choosing Back to chat returns to an empty composer. Settings replaces the chat page; pending files and the active job identity are also held in page memory.

**Proposal:** Open Settings in a dialog or side panel that preserves the chat. An explicitly indicated separate tab is a smaller interim option. Protect navigation that would discard an unsent draft or abandon the frontend's active attempt. Do not imply that a retained backend job is automatically restored after a page reload.

### EH-02 — Make the composer compact and show one primary action

**Priority:** High. **Effort:** Low–medium.

**Observed:** The empty textarea occupies about 116px. The mobile action area stacks attachment, Keep working, and Send controls. During generation, Stop adds another row alongside the disabled Waiting button.

**Proposal:** Start the textarea at one or two lines, grow it as the user types, and cap its expansion with internal scrolling. Return to the compact size after sending while retaining an accessible way to expand long-prompt editing. Replace Send with Stop during generation. Arrange attachment and request options in a compact toolbar rather than separate full-width rows. Preserve 44px touch targets, draft recovery, and attachment inspection.

### EH-03 — Reduce the conversation header to essentials

**Priority:** High. **Effort:** Low–medium.

**Observed:** The populated desktop chat header consumes about 127px. At phone widths, a long title collides with the Chats link, and the model/thinking selectors are cramped and truncate their values.

**Proposal:** Reserve a proper layout column for Chats and constrain the title to the remaining width. Keep a compact model summary visible; reveal model selection, thinking level, and capability details on demand. Remove redundant section labels where the context is already clear. Prevent desktop title/model wrapping from unexpectedly adding rows on short windows. Keep the full title and active settings accessible.

### EH-04 — Fit the available viewport height and prevent clipping

**Priority:** High. **Effort:** Medium.

**Observed:** Width-only breakpoints miss short laptop and landscape windows. Desktop uses a viewport-height shell with hidden overflow. Mobile chat sizing subtracts guessed header heights (`110px` or `165px`) and also imposes a `480px` minimum. The 844 x 390 browser check clips the composer actions entirely.

**Proposal:** Allocate remaining space through the layout instead of fixed header-height subtraction. Add a short-height layout treatment as well as width breakpoints. Evaluate dynamic viewport units with suitable fallbacks, browser chrome, safe areas, and actual keyboard behavior. Keep Send/Stop reachable; provide a sensible scrolling fallback when everything cannot fit. Avoid solving overflow with a larger unconditional minimum height.

### EH-05 — Reclaim decorative space and offer a reading mode

**Priority:** High for reduced chrome; medium for an optional mode. **Effort:** Low–medium.

**Observed:** Desktop shell padding alone uses 70px vertically, before the 80px app header, header/workspace gap, and chat-panel padding. The conversation is visually nested inside several padded surfaces.

**Proposal:** Tighten shell padding, header spacing, panel padding, and composer separation before reducing text size. Make branding/navigation a compact app bar. Consider a reversible reading mode that further reduces chrome and can collapse desktop history, while retaining Stop and access to navigation/settings. Wider answers can reduce wrapping, but keep a comfortable reading measure for prose.

**Scope note:** A mobile history drawer could simplify returning to the response, but it is not the main source of lost height: history currently sits below the chat rather than above it.

### EH-06 — Improve answer readability and visual hierarchy

**Priority:** Medium. **Effort:** Low.

**Observed:** Response prose is uniformly bold and monospaced, and multiple bordered surfaces compete with the content.

**Proposal:** Use normal weight for prose and reserve bold for actual emphasis. Preserve the terminal identity, branding, and code styling. Simplify nested borders and keep paragraph/list spacing deliberate. A system sans-serif prose option could be evaluated separately; no new font dependency is necessary. Do not reclaim height by shrinking every font or compressing line spacing until long answers become harder to read.

### EH-07 — Make Settings saving predictable

**Priority:** Medium. **Effort:** Low.

**Observed:** Thinking/context preferences save immediately; the system instruction requires Save; connection changes last only for the server session.

**Proposal:** Group Connection and Response preferences. Clearly label automatically saved controls and expose unsaved/saved feedback for the instruction. Explain connection persistence beside the control. Replace implementation-first wording such as `options.num_ctx` with plain guidance about context capacity and memory use, retaining technical detail only where helpful.

### EH-08 — Clarify request controls without adding permanent clutter

**Priority:** Medium. **Effort:** Low.

**Observed:** The Keep working explanation is a hover tooltip, and the Enter/Shift+Enter behavior is not disclosed in the composer.

**Proposal:** Provide concise tap- and keyboard-accessible help: “No time limit. Stop anytime. Off: 30-minute limit.” Associate it with the checkbox. Add a restrained desktop shortcut hint: “Enter to send · Shift+Enter for a new line.” Put secondary help in accessible disclosure or focus states where appropriate so it does not consume another permanent row. Retain a single visible status, including reconnecting and pending cancellation after output begins.

### EH-09 — Show honest connection and model readiness

**Priority:** High for reliability. **Effort:** Low–medium. **Evidence:** Source-confirmed; the failure branch was not reproduced in this browser review.

**Finding:** Model discovery can insert a fallback model name when no models exist or discovery fails. The underlying issue is reported through a visually hidden status, while Send readiness does not establish that a usable model was discovered.

**Proposal:** Show a visible “Ollama unavailable” or “No models installed” state with Retry and Settings actions. Avoid presenting an unconfirmed model as installed. Gate sending on usable readiness while retaining the draft. Verify empty-model and network-failure cases with mocks before implementation is accepted.

## Implementation sequence

1. Compact the empty composer and replace Send with Stop during processing (EH-02).
2. Reduce the chat header and fix mobile title/control collisions (EH-03).
3. Tighten outer chrome and address short-height clipping together (EH-04/EH-05).
4. Protect Settings navigation (EH-01), which is a separate high-priority data-loss concern.

These changes should increase reading space without changing PDF processing, model behavior, request retention, or the design identity.

## Verification criteria

- Compare `.messages` height against the baseline at 1149 x 773, 1149 x 600, 390 x 844, and 844 x 390. More content should be readable at the same text size; merely making the page taller is not an improvement.
- Check empty/new chats and long conversations with long titles, thinking controls both present and absent, and long tables/code blocks.
- Check idle, pre-token waiting, streaming, reconnecting, pending Stop, confirmed cancellation, actual error, expanded attachments, and long-draft editing states.
- Ensure the conversation and necessary actions remain reachable in short windows, at browser zoom, with browser chrome changing, and with the real phone keyboard open. Real keyboard behavior was not tested in this review.
- Verify keyboard navigation, focus restoration, accessible help, readable contrast, 44px touch targets, and exactly one visible progress message.
- Preserve scroll position while reading older output. If automatic scrolling is adjusted, follow new output only while the user is near the bottom and offer a way to return to the latest response.
- Use mocked services and synthetic attachments for regression checks; no real model inference or large PDF workload is needed for layout verification.

## Preserve

Keep the bounded attachment inventory, filename-specific removal controls, response model attribution, accessible model-details dialog, and prompt version-history protections. Escape dismissal and focus return in the model dialog were browser-verified.
