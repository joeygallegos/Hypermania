# T-01 — Compact attachment frontend

Owner: frontend coding agent. Status: dispatched after explicit approval.

Read root AGENTS.md, approved plan.md P-01 through P-07, and FR-001 through FR-008. PROJECT.md is absent. Implement the approved compact pending attachment behavior with the smallest readable diff.

Allowed files: public/app.js; public/index.html if necessary; public/style.scss; generated public/style.css; surface-contract.test.js; new focused attachment behavior test under test/; README.md attachment workflow paragraph. Do not edit server, dependency files, unrelated modules, plan/requirements, or management documents. You are not alone in the codebase: do not revert other agents' changes; respect ownership and accommodate existing edits.

Dependencies: plan and requirements approval complete. Interface decisions: reuse attachmentTray, attachmentToggle, preview, existing arrays/ingest/removal paths. Show/Hide remains available during processing; uploads/removal stay locked. Whole tray max-height min(240px, 30svh), vertical scroll. PDFs have no thumbnails/decorative tile; filenames wrap; compact image thumbnails remain. Collapse on ingestion/send with correct focus management. Preserve clearing/retry lifecycle.

Acceptance: every FR has evidence. Include meaningful behavioral tests (not only source regex), successful Sass build/surface/full suite, focused comment pass followed by rechecks. Seek real browser layout verification using available supported browser tools without installing dependencies; if browser setup needs parent support, report promptly. Check representative 1149x773 and 390x844 layouts and supplied scenarios. README records workflow. No dependency changes.

Return files changed, FR-to-evidence mapping, exact commands/results, browser evidence, material limitations, and remaining issues. Do not commit or modify other files.
