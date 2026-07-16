# Autonomous homeschool operations assistant

Status: DONE — 2026-07-14

Klio now treats the teaching plan and family record as its authoritative workspace. Meaningful learning events enqueue idempotent, family-scoped evaluations; cautious trend rules can create or retire evidence-linked supplemental practice; unfinished curriculum is moved without breaking sequence or capacity; and every automatic schedule change is audited and safely undoable.

The implementation adds:

- family autonomy presets and bounded per-action policy decisions;
- durable proactive evaluations, ranked parent-facing insights, evidence references, progress, and quiet no-op outcomes;
- dynamic subject-aware practice grounded in approved related evidence;
- server-validated adjustment application and stale-safe undo RPCs;
- normalized work receipts, queued/running heartbeat semantics, stale recovery, bounded retries, and one mutating family turn at a time;
- an open-ended handoff tray, compact active receipt, ranked schedule notes, distinct supplemental work, drag-to-move week planning, source-backed review, evidence-led progress, activity history, and focused settings;
- RLS and family-isolation coverage for every new exposed table.

Verification completed:

- local schema reset and generated database types;
- 90 Vitest unit/integration/security tests across 26 files;
- TypeScript, ESLint, and production Next.js build;
- the complete Playwright suite with live provider access (10 passed), including scenarios proving that one open handoff records explicit History completion and moves unfinished Biology without unsupported practice, and that an open evidence handoff leaves a durable finished receipt;
- a controlled worker termination proving the paired local development command stops the web process visibly, followed by a successful worker/web restart.

The local application and durable worker run together with `pnpm dev` at `http://localhost:3100`.

## Seeded-family week follow-up — 2026-07-14

- Removed the oldest-250 assignment query ceiling by paging the complete family assignment set, so a two-month seed reaches the current week and all learners.
- Replaced the overlapping pinned-note week layout with a compact attached note rail, one aligned five-day family canvas, and a collapsed handoff tray below it.
- Added a seeded-account browser regression covering the exact Jul 13–17 date range, all five lanes for Jacob, Maya, and Noah, attached-note geometry, aligned weekday columns, and viewport overflow.

## Infinite workspace follow-up — 2026-07-14

- Replaced the fixed Today and This Week dashboard compositions with a 3,200 × 2,300 spatial desk: drag empty space to pan, use keyboard/buttons or Ctrl/Command + wheel to zoom, and use named landmarks to glide directly to schedule, attention, review, progress, or records.
- Added overview, working, and detail zoom states so the weekly shape stays legible at a distance while assignment detail returns at closer scales.
- Made schedule papers, Klio notes, progress, and records independently movable; object positions persist per family view and can be restored with the workspace reset control.
- Kept the daily/weekly schedule central without letting it own the viewport. Ranked Klio work remains nearby while practice, records, and longer-horizon progress sit farther across the canvas.
- Reduced the shell to Home, Students, Calendar, and Records, and pinned the open handoff control surface independently of canvas movement with contextual actions available from any location.
- Added browser coverage for pan/zoom, landmark focus, object movement persistence, the three-learner seeded week, mobile centering, responsive navigation, fixed handoff behavior, and document overflow.
- Refined the camera model so Home opens snapped to the daily plan, Calendar opens snapped to the weekly schedule, destination buttons visibly identify and focus their section, manual panning releases the snap, and reset returns to the relevant schedule.
- Verified 90 Vitest tests across 26 files, ESLint, TypeScript, the Next.js production build, the standard Playwright suite (8 passed, 3 opt-in scenarios skipped), and the real seeded-family canvas scenario (1 passed).

## Spatial focus and durable-layout follow-up — 2026-07-14

- Added explicit Workspace, section, Back, and Escape camera paths, with touch panning, pinch zoom, trackpad navigation, and keyboard pan/zoom/reset controls.
- Lessons now open in place at detail zoom. Daily blocks expand into their working detail; weekly blocks open a nearby lesson paper with completion, submitted sources, review, and handoff actions without leaving the canvas.
- Review, Progress, and Records are working canvas surfaces rather than primary links to dashboard pages. Reviews support one-action approval, progress separates curriculum and practice results, and records expose the actual filed sources.
- Added versioned family-scoped workspace layouts in Supabase, a strict bounded save endpoint, generated types, RLS policies, cross-family security coverage, server save status, and local fallback. Optional objects use a partial strict record so valid layouts save even when a note is absent.
- The seeded Timofeyev regression now proves all three learners remain scheduled, lesson focus is fully visible, Back and Escape restore the plan, moved objects save to Supabase and survive reload, mobile stays contained, and test cleanup restores the family’s prior arrangement.
- Final verification: 91 Vitest tests across 26 files, 12/12 RLS tests, ESLint, TypeScript, database lint, migration parity, production build, standard Playwright suite (8 passed, 3 opt-in skipped), and the real seeded-family canvas scenario (1 passed). Next.js and the durable worker are running together at `http://localhost:3100`.

## Guided spatial command-center completion — 2026-07-14

- Reframed the canvas as a prepared teaching desk: Today and Week now open at a computed readable working zoom, while overview simplifies content and detail focus exposes the active lesson or review.
- Standardized reliable Schedule, Attention, Review, Progress, and Records snap destinations; centered the date/range frame; kept the handoff fixed; and removed operational serif type, gradients, and unreadable metadata.
- Added deterministic collision repair for invalid or overlapping saved layouts, world-bound clamping, a family-persisted reset control, and background-safe initial camera positioning. Existing user arrangements remain intact when valid.
- Connected Records to durable Klio activity history while keeping the four-destination shell, and corrected the Timofeyev seed’s Writing & Grammar label without changing stable assignment or curriculum IDs.
- Added regression coverage for layout repair and stale-heartbeat receipt honesty. The browser now proves a stale job stops animating, says the original source is safe, and exposes Retry and Dismiss.
- Final verification: 94 Vitest unit/integration/security tests across 27 files; ESLint; TypeScript; Supabase database lint and migration parity; optimized Next.js production build; standard Playwright suite (8 passed, 3 explicit opt-in scenarios skipped); seeded three-learner desktop/mobile workspace (1 passed); live open-ended handoff (1 passed); live durable agent receipt (1 passed); and stale receipt browser coverage (1 passed).

## Autopilot operations follow-up — 2026-07-15

- Replaced broad “today needs a look” summaries with deterministic follow-through: normal planned work stays quiet, overdue curriculum sequence is repaired, due operational reschedule reminders are executed, and evening unfinished work moves through the existing undoable policy gateway.
- Removed static rail placeholders and operational reminders that merely told the parent to perform work Klio can safely do. The workspace now surfaces only concrete notices, adjustments, ready practice/review, or one precise missing detail.
- Renamed the recommended autonomy preset to **Autopilot** and made its boundary explicit: ordinary organization, completion, practice, and safe schedule work happen automatically; inferred grades, curriculum direction, and destructive changes retain parent judgment.
- Learner setup now immediately invokes the family-scoped, capacity-aware week planner. Adding subjects places the learner’s lessons without disturbing siblings, and replaying the plan remains idempotent.
- Corrected mobile update sheets so their height follows useful content instead of covering the viewport with an empty panel, and ignored intentional deleted-turn cleanup without treating it as a worker failure.
- Final verification: 170 Vitest unit/integration/security tests across 42 files; TypeScript; ESLint; optimized Next.js production build; and the complete deterministic Playwright suite (11 passed, 3 explicit opt-in/fixture scenarios skipped).

## Focused learner-practice follow-up — 2026-07-15

- Consolidated every parent-facing practice launch into one distraction-free overlay over the teaching workspace. Learners answer one activity at a time without seeing the parent answer guide or leaving the schedule context.
- Kept objective scoring on the server and added a bounded, structured Klio check for open-ended explanations. Submitted responses now write the existing family-scoped practice result, evidence, audit, and proactive-evaluation records.
- Completed practice disappears from the active practice tabs and becomes one concise parent update. A successful result says the learner showed good understanding; a result that still needs support offers working **Add 10 minutes** and **Make follow-up** actions.
- Added idempotent session reuse, family-scoped follow-up validation, compact practice previews, and responsive overlay geometry with no stale transform after resizing.
- Final verification: 174 Vitest unit/integration/security tests across 43 files; TypeScript; ESLint; optimized Next.js production build; targeted autonomous-trend and learner-practice browser scenarios (2 passed); plus live seeded-account desktop and 390px mobile checks in the shared browser.

## Completed-update acknowledgement follow-up — 2026-07-15

- Added a durable **Acknowledge** action to completed schedule adjustments, including adjustment-linked Klio insights. The update removes the notice from Today and Week while keeping server-validated **Undo change** available on the acknowledged entry in Activity.
- Acknowledgement uses “seen through” semantics: one click clears that update and any older completed adjustment backlog, while newer work remains visible. The mutation is family scoped, idempotent, audited, and persisted across reloads.
- Added generated database fields, an unacknowledged-workspace index, cross-family RLS coverage, and end-to-end coverage for immediate removal, reload persistence, idempotent replay, and retained undo eligibility.
- Verified Supabase schema lint, 175 Vitest unit/integration/security tests across 43 files, TypeScript, ESLint, the optimized production build, and the unfinished-work browser scenario. In the shared seeded account, one acknowledgement cleared seven accumulated completed adjustments; reload showed no replacement backlog, and the repeated API action returned an idempotent success. Next.js and the durable worker are running together at `http://localhost:3100`.

## Practice correction follow-up — 2026-07-15

- Added a calm **No longer needed** path to ready supplemental practice. Parents can say the learner covered the skill in curriculum, already understands it, or that the practice is not the right fit without recording a false completion or score.
- A dismissal retires the active practice and its related Klio note, writes an append-only practice correction and audit event, and queues an idempotent proactive correction evaluation so future practice decisions use the parent’s signal.
- Kept the choice reversible before submission with **Keep practice**, preserved the curriculum and source artifact, and added explicit connection-failure copy that confirms the practice remains safe.
- Verified the interaction in the seeded shared browser without changing the family’s data; the dedicated browser scenario passed with durable correction, audit, insight, and evaluation assertions. Cross-family guessed-session dismissal is blocked by RLS. Final verification: 191 Vitest tests across 45 files, TypeScript, ESLint, the optimized production build, and the focused practice Playwright scenario. Next.js and the durable worker remain running at `http://localhost:3100`.
