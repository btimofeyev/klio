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
