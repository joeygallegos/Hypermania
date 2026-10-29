# Compact pending attachments

Status: Complete. Approved by the user on 2026-10-29: “Approve—implement the plan”. Independent consultant final gate: PASS.

## P-01 — Objective and scope

Keep the conversation and agent progress usable when many pending documents are attached. The visible attachment count opens a compact, bounded file inventory. PDFs use filename rows with a small type indicator, not thumbnails or decorative preview tiles. Compact image thumbnails remain available.

This change concerns pending composer attachments only. Preserve the existing lifecycle: successful sends clear pending attachments while documents remain in conversation context; failures retain the draft and attachments. Do not add a permanent conversation-file inventory, change PDF processing or model behavior, alter upload limits, add dependencies, or modify server behavior.

## P-02 — Confirmed RODES discovery

- Role: user is product owner; project manager coordinates a frontend implementer and independent reviewer. No other stakeholders are required.
- Objective: preserve chat/progress visibility with 11 or more attachments while retaining count, names, previews for images, and individual removal. User confirmed this scope.
- Details: reuse the existing count/toggle; collapse after adding files and at send start; bound expanded inventory with scrolling. No dependencies or server changes. User specified that PDFs do not need thumbnails.
- Examples: supplied 11-PDF screenshot, one PDF, mixed images/PDFs, long filenames, removal of the last file, and failed-send recovery. User confirmed these scenarios.
- Sense check: successful sends continue clearing the pending tray. User explicitly chose to preserve current behavior.

## P-03 — Current architecture and cause

The browser uses vanilla JavaScript in `public/app.js`, markup in `public/index.html`, and Sass in `public/style.scss`, compiled to tracked `public/style.css`. `ingestFiles` updates pending state and unconditionally opens the tray; `renderPreview` builds large cards; the tray has no height limit. The nonshrinking composer can therefore displace the message area. The current toggle already controls `hidden` and `aria-expanded`; existing removal handlers and request locks should be reused.

## P-04 — Implementation

1. Reuse the attachment button as a clear Show/Hide control with the image/PDF count. After ingestion and at send start, collapse the tray so its content cannot obscure progress. Keep adding, appending, pasting, and dropping supported through existing paths.
2. Render compact rows. PDFs get only a small type indicator, filename, and Remove. Images retain small thumbnails. Wrap long filenames within the row without widening the composer. Keep filename insertion through `textContent` and descriptive removal labels.
3. Limit the whole expanded tray to `min(240px, 30svh)` with vertical scrolling, including the upload control. Ensure focusable controls remain reachable, rows do not expand horizontally, and mobile removal targets remain usable. Retain the existing theme.
4. Allow Show/Hide for read-only inspection while a request runs; continue locking file addition/removal during processing. Keep aggregate counts and existing PDF progress labels accurate.
5. Document the compact tray workflow in the README and regenerate the compiled stylesheet.

## P-05 — Tasks and ownership after approval

- T-01: frontend implementer owns `public/app.js`, `public/index.html` if needed, `public/style.scss`, generated `public/style.css`, attachment behavior tests, relevant `surface-contract.test.js` assertions, and the README attachment paragraph. Satisfies FR-001 through FR-008. No server/dependency changes. Dependencies: explicit plan approval.
- T-02: project manager checks T-01 evidence against this plan and requirements, tracks status in `project-management/`, and requests focused remediation if required. Does not replace the independent final gate.
- T-03: fresh independent consultant reviews requirements, code, and tests without reading implementation briefs/status/prior assessments. Returns a severity-ranked written report and traceability matrix; only a pass completes the gate. Dependencies: T-01 verification and comment pass complete.

## P-06 — Verification and acceptance

Run stylesheet compilation, meaningful attachment behavior tests, the surface checks, and the full Node test suite using synthetic data and mocked PDF/Ollama tools only. Verify browser layout at desktop and mobile widths with synthetic attachment state: 11 PDFs; one PDF; mixed files; long names; expand/collapse with keyboard; scrolling to and removing the final row; no-file state; pending request inspection with mutation locked; and progress visibility. Exercise append/paste and send/recovery lifecycle through synthetic behavioral tests.

User-directed verification constraint (2026-10-29): “I don't want to stress out the GPU with a real upload of a bunch of PDF files, so can you please skip that test please?” Skip real PDF uploads/processing and real model inference. Parent owns isolated headless rendering against a static test server with mocked APIs, not the user's backend. Report the omitted real-upload test explicitly.

Use the supplied screenshot as the initial regression reference. Check computed tray bounds and positive visible message space at representative desktop (1149×773) and mobile (390×844) sizes. The expanded tray scrolls internally; the collapsed tray occupies no layout space. Record unavailable browser checks explicitly rather than substituting source assertions for layout evidence.

After tests pass, review modified code comments for non-obvious intent/security constraints, then rerun compilation and relevant tests. No dependency security lookup is needed unless scope changes to require a dependency, which needs approval.

## P-07 — Risks and scope control

Focus can be lost when collapsing a tray containing the active element; return it to the toggle when necessary. Busy inspection must never enable mutation. Long filenames and viewport height must not restore the overflow defect. Extreme viewport sizes and a manually enlarged textarea are existing layout constraints; avoid unrelated chat-layout redesign. Flag material conflicts with these requirements before changing scope.

## P-08 — Approval

User explicitly approved this plan and `functional-requirements.md` on 2026-10-29: “Approve—implement the plan”.
