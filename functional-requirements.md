# Compact pending attachments — functional requirements

Status: Approved alongside `plan.md` on 2026-10-29: “Approve—implement the plan”.

## FR-001 — Persistent pending attachment summary

When pending files exist, the composer shows the current image/PDF counts even while the inventory is collapsed. A labeled Show/Hide control expands and collapses it. Zero files restores a clear add-files action. Counts update after append and removal.

## FR-002 — Compact default state

After selecting, dropping, or pasting supported files, the tray is collapsed and files remain attached. Beginning a send also collapses it. Collapsed content takes no layout space. Eleven PDFs must not displace chat/progress through attachment-card growth.

## FR-003 — Bounded expanded inventory

Expanded attachments, including their upload control, occupy at most `min(240px, 30svh)` and scroll vertically when needed. At 1149×773 and 390×844, all 11 filenames/removal controls are reachable through that region, the composer does not overflow horizontally, and the message area retains positive visible height.

## FR-004 — Compact identifiable files

Each PDF row shows a small PDF type indicator, its filename, and a removal control without a PDF thumbnail or decorative preview tile. Image rows retain compact thumbnails. Long filenames remain readable by wrapping without widening the composer. Filenames are inserted as text.

## FR-005 — Preserve attachment operations

Existing file selection, append, drop, paste-image, and individual removal operations continue working. Removing one item changes only the intended file and updates the count. Removing the last file restores the empty state. PDF limits and ingestion errors retain existing behavior.

## FR-006 — Accessible inspection

The toggle works with keyboard activation, exposes accurate `aria-expanded` and `aria-controls`, and has a clear state/action label. Each removal control identifies its file. Scrollable content and controls remain keyboard reachable. Collapsing a focused tray does not strand focus in hidden content. Mobile removal targets remain at least 44px tall.

## FR-007 — Processing and recovery

During a request the user can expand/collapse the inventory for inspection; adding/removing remains locked. Existing PDF preparation and response progress stay visible in the conversation when the tray is collapsed. A failed send retains draft text and pending attachments for retry. A successful send clears pending attachments as before; no permanent sent-file inventory is introduced.

## FR-008 — Scope and delivery checks

Keep implementation frontend-only, retain the visual theme, and add no dependencies. Compile tracked CSS, update the README attachment workflow, run relevant behavior/surface tests and the full practical test suite, complete the modified-code comment pass, and obtain an independent consultant pass with requirement-to-code/test traceability. Report unavailable verification and remaining limitations explicitly.
