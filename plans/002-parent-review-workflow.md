# Plan 002: Turn Review into a source-backed parent correction workflow

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 4a5949e..HEAD -- src/app/app/activity/page.tsx src/components/review-workspace.tsx src/app/api/review/route.ts src/lib/data/workspace.ts src/lib/agent/run-agent.ts src/components/app-nav.tsx src/app/globals.css e2e/prototype.spec.ts`
> These files already have uncommitted product work in the user's working tree. Preserve it. If the live review flow materially differs from the "Current state" below, STOP and report instead of overwriting it.

## Status

- **Priority**: P1
- **Effort**: L (multi-day product slice)
- **Risk**: MED — changes the parent approval boundary and the context supplied to future agent runs
- **Depends on**: none — the implemented local prototype portions of Plan 001 are the baseline; its deferred deployment and pilot work are not prerequisites
- **Category**: direction, correctness, tests
- **Planned at**: commit `4a5949e`, 2026-07-11

## Why this matters

Review is Klio's trust checkpoint: AI-created conclusions and materials must remain drafts until a parent confirms them. The current screen asks for approval without showing the source evidence, uses system vocabulary, mixes unrelated entities in one flat queue, and discards useful correction detail when a parent rejects something. After this plan, a parent can see what Klio read, what it concluded, why, and what approval changes; corrections will inform later Klio runs.

## Product contract

Use this parent-facing framing throughout the feature:

> Check what Klio understood before it uses it to help plan what comes next.

Every suggestion must answer:

1. What did Klio see?
2. What did Klio conclude or make?
3. Why did it reach that conclusion, including uncertainty?
4. What changes when the parent accepts it?

Use these labels:

| Internal concept | Parent-facing label |
|---|---|
| Review | Check Klio |
| Pending review | Needs your input |
| Skill observation | Something Klio noticed |
| Artifact | Something Klio made |
| Approve | Looks right |
| Reject | Not quite |
| Audit history | Recent decisions |
| emerging | Just getting started |
| developing | Still practicing |
| secure | Doing this independently |
| needs-review | Needs another look |

Do not rename database values. Translate only at the presentation boundary.

## Current state

- `src/app/app/activity/page.tsx:9-18` queries all draft artifacts and observations directly. It does not load `approval_requests`, source relationships, artifact rationale/content, observation uncertainty, or evidence previews.
- `src/components/review-workspace.tsx:60-75` flattens both entity types into one list. A parent must select a checkbox before approve/reject appears. Rejection sends no reason. Confidence is present in the DTO but never rendered.
- `src/app/api/review/route.ts:37-78` loops sequentially and throws on the first error. Earlier items may already be updated while the client receives a general failure. The route already validates family membership and scopes entity updates to `family_id` and draft status; preserve those controls.
- `src/lib/data/workspace.ts:99` computes the navigation badge from pending `approval_requests`, while the page displays raw draft rows. Make `approval_requests` the source of truth for both.
- `src/lib/agent/run-agent.ts:21-28` loads approved observations and filing corrections, but not rejected observations/artifacts or their parent reasons. Generic rejection therefore does not improve later output.
- `src/components/artifact-view.tsx:25-33` is the existing pattern for displaying uncertainty, rationale, and structured artifact content. Reuse its content shape rather than inventing a second schema.
- `src/app/globals.css:539-569` contains the current review UI styles. Extend this design system: warm paper background, restrained green/clay, DM Sans for controls, serif for document-like content, no generic dashboard-card grid.
- `e2e/prototype.spec.ts:90-115` only checks approval from an artifact page during an optional live-agent test. There is no deterministic coverage for the review queue, edits, rejection reasons, source display, mobile layout, or partial bulk results.
- The MVP contract in `plans/001-homeschool-agent-mvp.md` requires source-backed drafts, uncertainty, parent correction, and no automatic approval. Preserve those boundaries.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0, no TypeScript errors |
| Lint | `npm run lint` | exit 0, no lint errors |
| Unit/integration tests | `npm test` | all tests pass |
| Review browser test | `npx playwright test e2e/review.spec.ts` | all review cases pass |
| Existing capture browser test | `npx playwright test e2e/prototype.spec.ts -g "creates a workspace"` | pass |
| Production build | `npm run build` | exit 0 |

## Suggested executor toolkit

- Read `node_modules/next/dist/docs/` for the installed Next.js 16.2.10 conventions before changing route or server-component code, per `AGENTS.md`.
- Use `frontend-skill` or `design-taste-frontend` for the responsive review interaction.
- Use `supabase` and `supabase-postgres-best-practices` if a database function or migration becomes necessary. Do not bypass RLS or move authorization into the client.

## Scope

**In scope**:

- `src/app/app/activity/page.tsx`
- `src/components/review-workspace.tsx`
- `src/app/api/review/route.ts`
- `src/lib/data/workspace.ts`
- `src/lib/agent/run-agent.ts`
- `src/components/app-nav.tsx`
- `src/app/globals.css`
- `e2e/review.spec.ts` (create)
- Focused unit/integration test files needed for review result handling or context assembly

**Out of scope**:

- The capture composer, records search, plans UI, portfolio UI, Stripe, authentication, and file-upload pipeline.
- Database enum/value renames. Keep `artifact`, `skill_observation`, `draft`, `approved`, `rejected`, `emerging`, `developing`, `secure`, and `needs-review` internally.
- Automatic approval, learner-facing approval, or a general chatbot.
- Deleting audit history or raw evidence.
- A complete rewrite of artifact documents. Link to or reuse the existing artifact view when full content is needed.

## Git workflow

- Work on `feat/parent-review-workflow` if a branch is requested.
- Preserve the user's existing uncommitted changes and do not reformat unrelated CSS.
- Use conventional commits if asked to commit, for example `feat(review): add source-backed parent corrections`.
- Do not push or open a PR unless explicitly instructed.

## Steps

### Step 1: Make pending approval requests the queue source of truth

Refactor `src/app/app/activity/page.tsx` to load pending `approval_requests` first, ordered newest-first. Collect artifact and observation IDs from those requests, then load only those draft entities. Include `requested_by_run` so items can be grouped by the capture/agent run that created them.

For artifacts, load at least: `id`, `agent_run_id`, `student_id`, `type`, `title`, `summary`, `rationale`, `content`, `created_at`, and `artifact_sources` with nested evidence fields `id`, `kind`, `title`, `raw_text`, `mime_type`, `source_at`.

For observations, load at least: `id`, `student_id`, `subject`, `skill_label`, `status`, `rationale`, `confidence`, `uncertainty_flags`, `created_at`, and `observation_evidence` with the same evidence fields.

Map both types into a shared client DTO containing:

- `requestId`, `runId`, `entityType`, and `id`
- learner name and created time
- parent-facing title, explanation, uncertainty, and consequence copy
- one or more sources with enough data for an inline excerpt/thumbnail indicator and a `View original` link
- artifact details sufficient to preview what was made

Skip stale pending requests whose entity no longer exists or is no longer draft, but expose a server-side cleanup helper or explicit diagnostic so they cannot silently inflate the badge forever. Do not display drafts lacking a pending approval request.

Change `getWorkspace()` only if needed to ensure its badge count uses the same pending-request rules. Do not add a second count query.

**Verify**: `npm run typecheck` → exit 0. Add a data-mapping test that proves one pending artifact and two observations from one run form one group, while a draft without a pending request is absent.

### Step 2: Build source-backed review groups in parent language

Replace the flat queue in `src/components/review-workspace.tsx` with groups keyed by `runId`; when `runId` is null, use the approval request ID so unrelated legacy items never merge.

Each group must show:

- Source heading such as `Jacob's fraction worksheet`, learner, and date.
- Inline text excerpt for notes; a file/photo/voice indicator for uploaded evidence.
- `View original` linking to the existing authorized evidence download route when a file exists. Do not create public Storage URLs.
- A `Something Klio noticed` section for observations.
- A `Something Klio made` section for artifacts.

Each suggestion must display its conclusion, explanation, translated learning status, confidence only when it is useful, uncertainty flags, and one sentence explaining approval impact. Do not display internal entity names or raw status values.

Keep full artifact documents accessible through `/app/artifacts/[id]`; the review group may summarize structured sections but must not pretend that editing title/summary edits the complete artifact.

Replace page copy with:

- Eyebrow: `Needs your input`
- Heading: `Check Klio`
- Description: `Check what Klio understood before it uses it to help plan what comes next.`
- Empty state: `You're all caught up` / `New suggestions will appear here when Klio needs your input.`

Rename the desktop and mobile navigation label from `Review` to `Check Klio`; retain `/app/activity` in this plan to avoid a route migration.

**Verify**: `npm run lint && npm run typecheck` → both exit 0. At 1440×900, source, conclusions, and actions are readable without horizontal scrolling.

### Step 3: Replace checkbox-first actions with explicit decisions

Give every suggestion three visible actions:

- `Looks right` — approves the single suggestion.
- `Edit` — opens only fields the parent can truly change. For an artifact, label title/summary editing as `Edit summary`, and provide `Open full draft` for full content. For an observation, allow subject, skill label, translated status, and rationale.
- `Not quite` — opens an inline or bottom-sheet correction form before rejecting.

The correction form must offer mutually clear quick reasons:

- Wrong learner
- Wrong subject
- Misunderstood the work
- Parent or sibling helped
- Not enough information
- Something else

Include optional detail, capped at 1000 characters. Submit a stable reason code plus human detail; serialize it into the existing `reason` field without exposing the code in parent-facing history. Never reject silently with only `Rejected by parent` from this screen.

Allow `Looks right for all` only inside one source/run group. Remove cross-group bulk rejection. A parent must supply correction context for every rejected suggestion.

Use optimistic removal only after the API confirms that specific item. Keep failed items visible with an adjacent error and retry action.

**Verify**: component tests or deterministic browser tests cover approve-one, edit-one, reject-with-reason, cancel-reject, and approve-one-group. All actions remain keyboard accessible.

### Step 4: Return honest per-item API results

Change `src/app/api/review/route.ts` so a multi-item request returns a result for every requested item rather than throwing a generic error after an earlier item already succeeded. The response shape should distinguish `completed`, `not_found_or_already_decided`, and `failed` per `{entityType, entityId}`.

Preserve:

- `requireParentApi()` authentication.
- Family membership verification before using the admin client.
- `family_id` and current-draft predicates on every entity update.
- Approval-request status updates and audit events.
- Zod request validation and maximum batch size.

Reject malformed reason codes/details. Audit metadata should record the stable correction code and whether detail was supplied, not duplicate student source text. Do not log raw notes.

If implementing true atomic per-item mutation requires a Postgres function, STOP and report before adding a migration; do not invent a security-definer function without a separate Supabase review.

**Verify**: add API-level tests for unauthorized, wrong family, invalid input, already-decided entity, successful edit, rejection with reason, and a two-item request where one succeeds and one is stale. The mixed request must report both outcomes accurately.

### Step 5: Feed parent corrections into future Klio context

Extend the context assembly in `src/lib/agent/run-agent.ts` to load a bounded set of recently rejected skill observations and artifacts for the selected learner, including only the fields needed to prevent repetition: type/subject, label/title, the rejected conclusion summary, rejection reason, and date.

Add a `parent_review_corrections` section to `buildContext()`. State in `KLIO_INSTRUCTIONS` that these corrections are authoritative negative examples: Klio must not repeat the rejected conclusion without materially new evidence, and must respect wrong-learner/help/insufficient-evidence corrections.

Keep the query bounded (recommended maximum: 20 observations and 10 artifacts) and learner-scoped. Do not send unrelated siblings' rejected material or entire artifact bodies.

**Verify**: extend the agent context tests with:

- A rejected observation and reason appear for the matching learner.
- Another learner's rejection is absent.
- Approved observations remain in approved context.
- A correction with “not enough information” appears as a constraint, not as an approved fact.

### Step 6: Make mobile review a focused sequence

At widths up to 900px, show one source group at a time with progress (`2 of 5`) and a persistent bottom action area above `.mobile-nav`. Keep the source preview and current suggestion scrollable inside the available viewport; the document itself must not gain horizontal overflow.

Use minimum 44px touch targets. `Not quite` should open as a bottom sheet or inline region that does not hide its submit action behind the mobile navigation. After a confirmed decision, advance to the next suggestion. Preserve the ability to go back before a decision, but do not provide undo after a server-confirmed decision in this plan.

Desktop should retain grouped scanning, with individual actions and optional group approval.

**Verify**: Playwright checks at 390×844 that `document.documentElement.scrollWidth <= 390`, all three decisions are reachable, the correction submit is above the bottom navigation, and completing one item advances progress.

### Step 7: Replace raw audit rows with human-readable recent decisions

Keep audit history secondary and collapsed by default. Translate known review actions into sentences such as:

> Yesterday, you marked “Compares fractions” as still practicing for Jacob.

Do not show raw dotted actions or internal entity types. Include decision, learner, title/skill, relative date, and correction reason when appropriate. If the existing audit event metadata lacks enough information, enrich new review events prospectively; do not backfill or fabricate old history. Unknown legacy actions may use a neutral `A family record was updated` fallback.

**Verify**: test the formatter for approved artifact, edited observation, rejected observation with reason, and unknown legacy action.

### Step 8: Add deterministic end-to-end coverage

Create `e2e/review.spec.ts`. Seed transient family data with the existing Supabase admin test pattern and clean it in `finally`. Do not require a live OpenAI call.

Cover:

1. Pending source evidence plus one observation and one artifact appear in one group.
2. Parent approves the observation and it disappears while the artifact remains.
3. Parent rejects the artifact with a reason and the reason persists.
4. Navigation badge count decreases accurately.
5. A stale pending request does not create a visible empty review item.
6. Mobile one-at-a-time flow has no horizontal overflow.
7. Another family's pending items never appear.

Model cleanup after the existing `e2e/prototype.spec.ts` admin-client `finally` blocks.

**Verify**: `npx playwright test e2e/review.spec.ts` → all cases pass without `RUN_LIVE_OPENAI_E2E`.

## Test plan

- Add focused pure tests for status/copy translation and audit-history formatting.
- Add API tests for authorization, validation, stale entities, mixed outcomes, edit, approve, and reasoned rejection.
- Add context-assembly tests for learner-scoped rejection feedback.
- Add deterministic Playwright coverage in `e2e/review.spec.ts` using direct test-data setup and cleanup.
- Retain and rerun the existing capture test to prove the home experience is unaffected.

## Done criteria

- [ ] The page and navigation say `Check Klio`; parent-facing UI does not say `artifact`, `skill observation`, or `audit history`.
- [ ] Every pending suggestion shows at least one source or an explicit `Source unavailable` state.
- [ ] Every suggestion has `Looks right`, `Edit`, and `Not quite` without requiring checkbox selection.
- [ ] Rejecting from this screen requires a reason selection and stores optional detail.
- [ ] Future agent context includes bounded, learner-scoped review corrections.
- [ ] Navigation badge and visible queue both derive from pending approval requests.
- [ ] Multi-item API responses report success/failure per item.
- [ ] Mobile at 390×844 has no horizontal overflow and keeps actions above bottom navigation.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npx playwright test e2e/review.spec.ts`, the existing capture E2E, and `npm run build` all exit 0.
- [ ] `git diff --check` exits 0.
- [ ] No out-of-scope files are modified.
- [ ] The plan status in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- In-scope files materially differ from the current-state descriptions because another UI pass landed after this plan.
- Source relationships cannot be fetched through the existing `artifact_sources` and `observation_evidence` tables without changing database ownership or RLS.
- Correct per-item mutation requires a new security-definer database function; that requires a separate Supabase security review.
- Existing rejection reasons contain sensitive raw source data that would be forwarded to the model.
- The mobile shell cannot support an internal scroll region without changing `.app-shell` or `.mobile-nav` behavior outside the review route.
- Any verification command fails twice after a reasonable scoped fix.

## Maintenance notes

- Keep approval requests as the durable queue source; future draft-producing features must create one pending request per reviewable entity.
- Correction reason codes are a product contract. Add new codes compatibly and preserve old formatter behavior.
- Reviewers should scrutinize family/learner scoping, data sent into the model, and partial-failure reporting more closely than visual details.
- Consider route migration from `/app/activity` to `/app/review` later with a redirect; it is intentionally deferred to avoid mixing navigation cleanup into the trust-flow change.
- Track approval, edit, rejection, later reversal, source-open rate, and median review time during a private pilot. Do not add analytics that capture raw child work or notes.
