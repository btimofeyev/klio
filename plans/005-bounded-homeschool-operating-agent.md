# Bounded homeschool operating agent

Status: DONE — 2026-07-14

## Mission

Make Klio reliably keep a homeschool family organized and on track while acting as a carefully bounded teacher assistant, grader, planner, and operations assistant. The family record remains authoritative: models may interpret evidence and draft content, but server-authorized domain tools, parent policy, RLS, snapshot staleness, idempotency, audit provenance, and undo govern every action.

## Completion contract

This plan is complete only after all twelve slices below are implemented, the required local verification suite succeeds at one final repository state, documentation describes actual behavior, and no exposed control or terminal receipt depends on an unimplemented handler.

## Ordered vertical slices

| Slice | Scope | Depends on | Status |
|---|---|---|---|
| 1 | Academic terms, instructional days, learner goals, subject pacing targets, deterministic pace calculations, RLS, audit/context triggers | — | DONE |
| 2 | Relevance-ranked bounded workspace snapshot, purpose windows, targeted family-scoped reads, >200-history regression | 1 | DONE |
| 3 | Strict goal, curriculum, assignment, schedule, completion, score, review, lesson, and practice tool contracts and gateway handlers | 1–2 | DONE |
| 4 | Truthful autonomy policy matrix with usable automatic/undo/confirm/ask/never enforcement | 3 | DONE |
| 5 | Idempotent proactive preparation, reconciliation, evidence, correction, submission, completion, schedule, and weekly handlers | 1–4 | DONE |
| 6 | Evidence-grounded structured practice generation, provenance, capacity-aware scheduling, needs-detail, and undo | 3–5 | DONE |
| 7 | Integrated grading/review loop with provisional/final semantics and finalized comparable trend evidence | 3, 5–6 | DONE |
| 8 | Durable ask-parent answer, cancel, resume, stale recalculation, and duplicate protection | 3 | DONE |
| 9 | Validated terminal action cards, host-built internal destinations, evidence/review/approval/undo UI, legacy fallback | 3–8 | DONE |
| 10 | Honest curriculum links: bounded parent-authorized ingestion if it meets SSRF controls, otherwise relabeled source-link capture | 2, 9 | DONE — reference-only; Klio does not fetch links |
| 11 | Fair bounded multi-family worker concurrency with per-family mutation serialization, heartbeat recovery, and deterministic tests | 3–8 | DONE |
| 12 | Required unit, RLS, integration, Playwright, build, database reset/types/lint/parity verification and documentation | 1–11 | DONE |

## Architecture decisions

- Store terms, instructional-day exceptions, goals, pacing targets, and goal evidence as normalized family-scoped records. Derived pace is deterministic application logic, not model prose or an opaque plan blob.
- Separate a compact standard snapshot from bounded, purpose-specific read tools. Deterministic selection always favors overdue, current, upcoming, pending-review, recently finalized, corrected, and policy-relevant records.
- Keep tool vocabulary domain-specific. The runtime never receives generic SQL, shell, filesystem, HTTP, browser, arbitrary URL, or arbitrary-record mutation capabilities.
- Treat grading as provisional until all required responses are reviewed and a parent-approved/final result exists. Only finalized comparable curriculum evidence may drive mastery and long-term support removal.
- Represent confirmation, clarification, undo, review, and safe navigation as validated server-owned action descriptors. Model text cannot choose an arbitrary destination or execute a client command.
- Serialize family mutations while allowing unrelated families to progress concurrently. Retries remain idempotent and bounded.

## Verification gates

- Each migration: local reset, database/RLS tests, generated types, targeted TypeScript tests.
- Each agent slice: valid/invalid/stale/cross-family/duplicate coverage for every write path.
- Each parent surface: component/unit coverage plus the required Playwright workflow.
- Final state: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `supabase db reset --local`, `pnpm db:types`, configured database lint/parity checks, and the complete RLS suite.

## Intentional exclusions

- No state-law compliance engine or automatic legal prescription.
- No unrestricted browsing, arbitrary URL fetch, generic database mutation, source-evidence deletion, or client-side service credentials.
- Credits, hours, standards, attendance, and instructional-day records are parent-configurable planning facts only.

## Delivered result

- Normalized terms, learning weekdays/exceptions, actual instructional-day records, goals, pacing targets, append-only goal progress, and derived checkpoints now make on-track status deterministic and provenance-aware.
- The standard agent snapshot selects decision-relevant cohorts and remains correct with more than 200 historical assignments; deeper context is available through bounded read tools.
- The gateway supports scoped homeschool operations for assignments, schedules, goals, curriculum proposals, explicit completion/scores, grading drafts, feedback returns, lessons, and grounded practice, with family ownership, staleness, idempotency, policy, redaction, and audit enforcement.
- Proactive event handling covers assignment, submission, grade, practice, unfinished work, schedule, capture, correction, evidence, daily, weekly, and manual events. Quiet states persist as no-op outcomes.
- Written and mixed work remain provisional until reviewed. Final comparable approved evidence alone can affect pacing, trends, practice creation, or support removal.
- Clarification and terminal receipts are durable parent action surfaces with inline answer/cancel, review/approve/reject/edit, safe internal navigation, and undo.
- Worker execution is concurrent across families and serialized per family through renewable, recoverable leases.

## Final verification

Completed at the final migration state on 2026-07-14:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` — 39 files, 146 tests passed, including the complete RLS suite
- `pnpm test:e2e` — 11 deterministic workflows passed; 3 existing opt-in/fixture-gated workflows skipped
- `pnpm build`
- `supabase db reset --local`
- `pnpm db:types`, followed by typecheck and tests
- `supabase db lint --local --level warning` — no schema errors
- `supabase migration list --local` — local and applied migration versions matched through `20260714230600`

The live OpenAI browser workflow remains opt-in through `RUN_LIVE_OPENAI_E2E=1` and was not run as part of deterministic local verification.

## Agent-decided conversation — 2026-07-16

- Removed the hardcoded greeting/thanks response table and its client-only synthetic turns. Every parent message now stays in Klio’s durable conversation so the model—not a regex—decides whether to answer briefly, inspect workspace context, or perform bounded follow-through.
- Removed natural-language chat/practice/record intent classification from the universal composer. Plain text enters one adaptive Klio turn; only explicit attachment and lesson-state controls retain deterministic evidence handling.
- General conversation receives the complete bounded Klio tool vocabulary. The capability token and tool gateway still enforce family scope, snapshot freshness, idempotency, autonomy policy, approval, and audit rules for every attempted action.
- The focused conversation begins with one calm “Thinking” state. The operational work tray remains hidden unless Klio actually calls a workspace tool or reaches a concrete action step, so a greeting does not pretend that work was submitted or show a five-step Conductor receipt.
- Explicit product entry points such as creating practice or planning the week retain their narrower goal-specific tool scopes.
- Clarification state is now durable-tool-owned: model prose cannot move a turn into `awaiting_parent`. The conversation composer remains visible defensively when an older or malformed awaiting turn has no persisted clarification question.
- Reconciled legacy stranded clarification turns and their threads, and now require an open persisted question before either the runtime or parent UI can present a blocking detail state. The universal handoff also keeps identical geometry before and after focus on desktop and mobile instead of expanding or scrolling its canvas frame.

## Bounded multi-conversation focus — 2026-07-16

- Klio presents a continuous stream inside each selected conversation, while the family can create and switch among multiple durable conversations. A handoff from the workspace starts a new conversation; only a follow-up sent inside an open conversation continues it.
- Supabase keeps the durable parent-visible conversation index and messages. Family records—not conversation history—remain authoritative, and each turn still receives a fresh authorized workspace snapshot.
- When a provider thread is replaced after a runtime update or resume failure, the runtime restores a family-scoped recent window of at most 20 messages and 16,000 characters. The current request is excluded from that window, and stored conversation remains supplemental rather than family-record authority.
- The focused conversation hides the native scrollbar while retaining wheel, touch, and keyboard scrolling. Scroll-linked depth keeps current messages crisp and lets older exchanges soften and recede only as they approach the top edge, with a reduced-motion fallback.
- A stream resize observer keeps the newest reply in view after layout changes, while manual review of older messages remains undisturbed until the conversation content changes.
- Browser verification on the seeded Timofeyev family confirmed that recent conversations are selectable, only the selected conversation is loaded into the stream, the latest reply remains visible, the input stays reachable, and no scrollbar is exposed.

## Authoritative capacity rebalancing — 2026-07-16

- Added compact per-learner daily workload summaries to every agent snapshot so a truncated detailed-assignment window can no longer make an overloaded day look healthy.
- `organize_day_schedule` now has two deterministic host paths: it removes time overlaps on a healthy day, or rebalances the complete authoritative learner-day when it exceeds capacity.
- The capacity planner moves enough ordinary or supplemental work to future learning days, repairs existing curriculum-order violations, shifts dependent later lessons atomically, validates every affected destination, and refuses partial course shifts.
- Model-authored weekly proposals are intercepted when they attempt to fix only part of an already-overloaded source day. The gateway delegates the whole day to the deterministic rebalancer instead of persisting a misleading proposal.
- Every applied rebalance remains family-scoped, snapshot-bound, idempotent, audited, and server-undoable. Parent-facing results include measured before, after, and capacity minutes rather than model estimates.
- Live browser verification on the seeded Timofeyev family processed one family-wide Friday request and applied three undoable changes: Jacob `380 → 195 / 240`, Maya `295 → 150 / 210`, and Noah `170 → 100 / 120`. The week surface updated from 25 to 13 Friday lessons, and all destination days stayed within the relevant learner capacity.
- Final verification for this correction: lint passed; typecheck passed; 46 Vitest files / 223 tests passed; the production build passed; the shared browser showed the updated Friday schedule with no Next.js error overlay; Next.js and the durable worker were restarted together through `pnpm dev`.

## Action-first activity history — 2026-07-18

- Simplified Activity into two parent questions: what needs a decision now, and what Klio recently changed or completed. The empty attention state now says the family is caught up instead of showing an operational status panel.
- Replaced internal labels such as work receipt and observation with parent language, humanized dates, learner-aware titles, and short schedule summaries. Complete reasons, supporting evidence, and receipt provenance remain available on expansion.
- Limited the initial history to five readable events and placed older events behind one disclosure. Event titles render at 14px, context at 11px, and important status labels at 9px on both desktop and mobile.
- Kept actions next to the explanation they affect: schedule rows expose the full server-backed Undo action, weekly summaries link to the week, and receipt actions remain available in expanded details.
- Verified the real seeded Activity page in the shared desktop and mobile browser with no horizontal overflow. The focused review, downward-trend, and unfinished-work Playwright workflows passed; ESLint, full TypeScript, and the production build passed; Next.js and the durable worker were restarted together through `pnpm dev`.

## Bounded Students and Records dashboards — 2026-07-18

- Replaced the vertically stacked Students/settings page with a viewport-bound learner workspace: a compact roster selects one learner and the primary pane shows capacity, learning days, subjects, curriculum, weekly cadence, teaching context, records, and edit actions.
- Moved Academic plan, Klio autonomy, and Account into explicit page-level views so the tools remain available without forcing every family setting into one long document.
- Rebuilt Records as a calm three-pane desktop workspace with subject navigation, a chronological record, and evidence-backed progress visible together. Mobile uses explicit Files and Progress views while learner and subject choices remain immediately reachable.
- Removed document scrolling and accidental card elevation from both surfaces. Only the selected roster, subject list, record history, or settings form may scroll internally when its data exceeds the viewport.
- Added seeded desktop/mobile acceptance coverage for viewport height, horizontal overflow, learner isolation, Records view switching, and the preserved academic-planning and learner-setup flows.
- Final verification: full ESLint passed; TypeScript passed; 71 Vitest files / 395 tests passed; the focused Students/Records, academic-planning, and learner-setup Playwright workflows passed; the production build passed; Next.js and the durable worker were restarted together through `pnpm dev`.
