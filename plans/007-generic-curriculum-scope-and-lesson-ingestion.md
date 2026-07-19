# Plan 007: Build a generic 100-lesson scope and progressively enrich it from parent-provided materials

> **Executor instructions**: Read this plan completely before editing. Execute every step in order and continue through ordinary milestones without asking whether to proceed. Run every verification gate and preserve all unrelated working-tree changes. If a STOP condition occurs, stop and report the exact condition instead of improvising. When every done criterion passes, update this plan's status in `plans/README.md` to `DONE` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git status --short
> git diff --stat 758af2b..HEAD -- src/app/api/curriculum src/app/api/evidence/route.ts src/app/onboarding/actions.ts src/app/app/actions.ts src/components/operations-workspace.tsx src/components/subject-setup-fields.tsx src/lib/assignments src/lib/curriculum src/lib/data/operations.ts src/lib/data/operation-assignment-pages.ts src/lib/supabase/database.types.ts src/lib/supabase/rls.test.ts supabase/migrations e2e plans/README.md
> ```
>
> The repository was heavily dirty when this plan was written. Plan 006 was also actively being implemented in untracked/modified files, including assignment pagination helpers and a migration. Do not overwrite, rename, or duplicate that work. Plan 006 must be complete and verified before this plan changes the course library or begins creating 100 assignment rows per curriculum.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/006-date-scoped-cursor-paginated-operations.md`
- **Category**: direction, migration, feature, tests
- **Planned at**: commit `758af2b`, 2026-07-18

## Product decision

Start every new curriculum with a flat, generic annual scope of 100 durable, unscheduled items named `Lesson 1` through `Lesson 100`. Treat “lesson” as the default pacing unit, not a claim about the publisher's vocabulary. A publisher's test, review, project, chapter lesson, or unit lesson can still occupy one numbered slot; its kind and optional hierarchy are metadata that Klio learns later from parent-provided material.

Do **not** create 100 calendar events. In Klio's existing model, `assignments` are durable curriculum-backed work and `weekly_plan_items` are calendar placements. Therefore, the generic scope should be represented by 100 unscheduled curriculum assignments. The scheduler should place the next eligible existing assignments into a week instead of inventing new assignment rows every time it plans.

When a parent drops a file, photo, note, or private reference onto `Lesson 1`, Klio must immediately and deterministically attach that source to the stable Lesson 1 assignment. Klio then extracts a source-grounded title and metadata and presents a one-click suggestion such as:

```text
Lesson 1
Suggested name: Place value to 100
Type: Lesson · About 35 minutes
[Use these details] [Edit] [Keep “Lesson 1”]
```

The source attachment is not speculative and may happen immediately. Model-inferred curriculum identity, duration, and structure require a lightweight parent confirmation in this first release. This preserves Klio's existing boundary that inferred curriculum-direction changes are reviewed, while eliminating manual retyping.

Klio may also use its general familiarity with recognizable curriculum products to prepare a faster starting outline. For example, `7th grade > English > BJU Press` should be normalized into a course identity and may produce a publisher-aware scope suggestion. That suggestion is never presented as edition-exact unless it is grounded in a matching edition identifier, ISBN, copyright page, table of contents, teacher guide, or curated versioned catalog record. Model familiarity is a useful prior, not authoritative curriculum data.

## Why this matters

Parents should not have to fully transcribe a publisher's scope and sequence before Klio becomes useful. A default 100-lesson skeleton gives the scheduler a complete, understandable annual runway in seconds, while progressive enrichment lets the parent teach from whatever is actually in front of them. Stable lesson IDs also let Klio rename and enrich future work without breaking schedules, submissions, reviews, or audit history.

The architecture must distinguish three concepts that currently blur together:

1. **Annual scope** — the ordered set of durable curriculum assignments, usually 100 generic placeholders initially.
2. **Lesson material** — parent-provided source evidence attached to one of those stable assignments.
3. **Calendar placement** — a weekly plan row that schedules an existing assignment on a date/time.

## User experience to ship

### Quick course setup

The minimum course form is:

- learner;
- subject;
- course/curriculum name;
- lessons per school year, default `100`;
- times per week;
- typical duration and parent-support preference.

Creating the course produces the 100 unscheduled lessons. It does not ask for a first date and does not schedule the entire year. The existing explicit “Plan this week” action schedules only the next eligible lessons.

### Publisher-aware bootstrap

When the course name contains a recognizable publisher/product, Klio should progressively identify:

```text
Publisher: BJU Press
Product/subject: English
Grade: 7
Edition: Unknown (optional to confirm)
```

Course creation must not block on edition details. Klio creates the generic 100-lesson skeleton immediately, then offers one of these states:

- **Generic** — no reliable publisher match; continue with Lesson 1–100.
- **Recognized, edition unconfirmed** — Klio can suggest a likely starting outline, clearly labeled as an estimate with its assumptions.
- **Edition verified** — the parent supplied an ISBN, edition/year, cover/copyright page, table of contents, or matching versioned catalog entry; Klio can propose an edition-specific mapping.

The parent sees a concise choice rather than a setup interrogation:

```text
Klio recognizes BJU Press English 7.
The edition is not confirmed, so this is a starting outline—not an exact publisher map.
[Use Klio’s suggested outline] [Add edition or ISBN] [Keep 100 generic lessons]
```

If a single missing fact would materially improve the match, ask one question, such as “Which edition or copyright year is on the book?” The parent may skip it. Never invent an edition, ISBN, lesson count, or exact title sequence.

A publisher-aware outline is a reviewable course-level proposal. Applying it maps suggested names, kinds, and paths onto the existing stable generic assignment IDs. It does not delete/recreate lessons, schedule the year, or overwrite completed/submitted work. A later edition correction produces a diff against only untouched future placeholders.

### Progressive enrichment

Each course row shows its stable generic number and current title. An untouched row is visually quiet:

```text
Lesson 1                          Add material
Lesson 2                          Add material
```

The parent can either drag a supported file onto a row or use an accessible `Add material` button. After upload:

- the source is durably linked to that assignment;
- extraction status is visible;
- Klio suggests a title, type, instructions summary, estimated duration, and optional path such as `Unit 1 / Chapter 2`;
- the parent accepts, edits, or dismisses the suggestion;
- accepting updates only safe fields and synchronizes a future placement when allowed;
- the parent can always inspect which source produced the suggestion.

A course-level drop target also accepts a cover, copyright page, ISBN note, table of contents, or teacher-guide excerpt specifically to verify course identity or refresh the publisher-aware outline. Keep this visually and semantically separate from dropping lesson material onto a numbered lesson.

### Vocabulary and hierarchy

Keep the annual counter generic and stable. Store these separately:

- `sequence_number`: the pacing order (`1..100`);
- `curriculum_item_kind`: `lesson`, `assessment`, `review`, `project`, or `activity`;
- `curriculum_path`: optional ordered labels such as `['Unit 2', 'Chapter 4']`;
- title: the human name extracted from the source, such as `Chapter 4 Test`.

A test may count as Lesson 23 because it occupies one pacing slot. Unit and chapter labels group lessons but do not consume the 100 count by themselves. A future batch-outline importer can populate the same fields without changing this model.

## Current state

### Relevant files

- `supabase/migrations/20260712233222_homeschool_operating_loop.sql` — defines `curriculum_units` and durable `assignments`.
- `src/app/api/curriculum/route.ts` — currently creates a course and immediately creates/schedules a requested batch of 1–40 assignments.
- `src/lib/assignments/first-week.ts` — currently generates new sequence numbers and generic titles while computing a week.
- `src/lib/assignments/plan-family-week.ts` — inserts newly generated assignments, inserts placements, and increments `next_sequence_number`.
- `src/app/onboarding/actions.ts` — creates curriculum units during first family setup but no annual assignment scope.
- `src/app/app/actions.ts` — creates/reactivates curriculum units when learner subjects are edited and automatically plans the family week.
- `src/components/subject-setup-fields.tsx` — current learner setup captures course name and weekly frequency but no annual target.
- `src/components/operations-workspace.tsx` — current course drawer asks for start sequence, a maximum of 40 lessons, first date, weekdays, and time.
- `src/app/api/evidence/route.ts` — already accepts files and an optional assignment ID, stores private family evidence, and records the assignment ID in provenance.
- `src/components/inbox-workspace.tsx` — already has file drag/drop and assignment context patterns.
- `src/lib/agent/run-agent.ts` and `src/lib/assignments/draft-review.ts` — existing patterns for private file download, OpenAI structured output, `store: false`, safety identifiers, and persisted result/error state.
- Plan 006 files — provide course cursor pagination and aggregate counts required before 100-row scopes become the default.

### Current schema already points toward this model

At `supabase/migrations/20260712233222_homeschool_operating_loop.sql:7-22`, a course has a sequence label and a next number but no annual target:

```sql
create table public.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject text not null,
  title text not null,
  sequence_label text not null default 'Lesson',
  next_sequence_number integer not null default 1,
  default_minutes integer not null default 40,
  schedule_rule jsonb not null default '{"days":[]}'::jsonb,
  status text not null default 'active'
);
```

At lines 25-50, an assignment already has nullable scheduling fields and unique course sequence identity:

```sql
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  student_id uuid not null,
  curriculum_unit_id uuid,
  title text not null,
  instructions text,
  sequence_number integer,
  status text not null default 'planned',
  scheduled_date date,
  scheduled_time time,
  estimated_minutes integer,
  unique (curriculum_unit_id, sequence_number)
);
```

The table comment says: `Durable curriculum-backed work; weekly_plan_items are only calendar placements.` Preserve that decision; do not add a second outline-item table that competes with assignments.

### Course creation currently couples scope to calendar placement

At `src/app/api/curriculum/route.ts:10-17`, the request is limited to 40 rows and requires calendar details:

```ts
startSequence: z.number().int().min(1).max(10000).default(1),
count: z.number().int().min(1).max(40).default(10),
startDate: z.iso.date(),
weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
scheduledTime: z.string().regex(...).nullable().optional(),
```

At lines 41-52, it creates dated assignments and placements together:

```ts
const dates = scheduleDates(input.startDate, input.weekdays, input.count);
const assignments = await supabase.from("assignments").insert(
  dates.map((scheduledDate, index) => ({
    title: `${input.title} · ${input.sequenceLabel} ${input.startSequence + index}`,
    sequence_number: input.startSequence + index,
    scheduled_date: scheduledDate,
  })),
);
await supabase.from("weekly_plan_items").insert(/* one placement per assignment */);
```

This is the coupling to remove. Course creation should establish scope; weekly planning should establish placements.

### Weekly planning currently invents assignment identity

At `src/lib/assignments/first-week.ts:81-96`, the planner calculates the next number and generic title itself:

```ts
const nextSequence = new Map(activeUnits.map((unit) => [unit.id, unit.nextSequenceNumber]));
// ...
const sequenceNumber = nextSequence.get(unit.id) ?? unit.nextSequenceNumber;
return {
  curriculumUnitId: unit.id,
  title: `${unit.title} · ${unit.sequenceLabel} ${sequenceNumber}`,
  sequenceNumber,
  scheduledDate,
};
```

At `src/lib/assignments/plan-family-week.ts:192-240`, the application inserts those assignments and then increments `next_sequence_number`. Replace this with conditional scheduling of existing unscheduled assignments.

### Evidence upload already knows assignment context but treats it as learner work

At `src/app/api/evidence/route.ts:58-62`, an assignment-scoped upload is family-validated. At lines 82-88, the assignment ID is preserved in evidence provenance. At lines 110-137, however, any linked source is categorized as `Assignment work` and returned as completed filing. Curriculum teacher material needs an explicit purpose and a normalized source relation so it is never confused with a learner submission.

## Architecture and safety rules

1. **Stable identity**: Dropping material onto Lesson 1 never replaces the assignment row or changes its ID.
2. **No annual calendar flood**: Generic rows have `scheduled_date = null` and no `weekly_plan_items` row until selected by weekly planning.
3. **No source loss**: Upload/link succeeds independently of AI extraction. If extraction fails or no OpenAI key exists, the source remains attached and manual editing remains available.
4. **No learner-work confusion**: Curriculum materials use a dedicated relation and capture purpose. They are never inserted into `assignment_submission_evidence` unless later submitted by the learner as actual work.
5. **Parent confirmation**: The model can suggest descriptive metadata but cannot apply it directly in v1. A parent-confirmed API mutation applies the suggestion.
6. **Historical snapshots**: Submitted, needs-review, or completed assignments retain their recorded title/instructions/duration. A newly attached source can be visible, but inferred changes do not rewrite completed learning history.
7. **Future schedule safety**: Title/kind/path may propagate to a planned future assignment and placement. A duration change must pass the existing schedule-fit validation; if it does not fit, keep the current duration and surface a clear scheduling decision.
8. **Family isolation**: All new tables use RLS and composite family foreign keys. The browser never receives or uses the secret/service role key.
9. **Source-grounded extraction**: The extractor receives only the selected assignment/course context and attached parent evidence, uses structured output, `store: false`, and no unrestricted URL fetch.
10. **Reversible and audited**: Applying or dismissing a suggestion writes an audit event with IDs and changed field names, not raw document contents.
11. **Provenance is visible**: Every course-level outline suggestion records whether it came from a generic default, unverified model prior, parent evidence, or a versioned curated catalog entry. The UI never collapses those sources into “Klio knows.”
12. **Edition drift is expected**: A publisher/product match without edition evidence may suggest structure, but exact item titles/count/order remain assumptions until confirmed.

## Target data model

Create a migration through the Supabase CLI. Exact names may match these:

### `curriculum_units` additions

```sql
target_lesson_count integer not null default 100
  check (target_lesson_count between 1 and 500),
publisher text,
product_name text,
grade_label text,
edition_label text,
isbn text,
identity_status text not null default 'generic'
  check (identity_status in ('generic', 'recognized', 'verified')),
scope_source_kind text not null default 'generic'
  check (scope_source_kind in
    ('generic', 'model_prior', 'parent_evidence', 'curated_catalog')),
scope_confidence numeric(4,3)
  check (scope_confidence is null or scope_confidence between 0 and 1),
scope_verified_at timestamptz
```

Continue to show `sequence_label`, defaulting to `Lesson`. For this phase, set `next_sequence_number` to one greater than the greatest existing sequence for compatibility, but remove it as the weekly planner's source of new identity.

Normalize and validate publisher/product/grade/edition/ISBN at the application boundary. Do not use these text fields directly as authorization keys or assume that equal publisher strings imply the same edition.

### `assignments` additions

```sql
curriculum_item_kind text
  check (curriculum_item_kind is null or curriculum_item_kind in
    ('lesson', 'assessment', 'review', 'project', 'activity')),
curriculum_item_state text
  check (curriculum_item_state is null or curriculum_item_state in
    ('placeholder', 'enriched')),
curriculum_path jsonb
  check (curriculum_path is null or jsonb_typeof(curriculum_path) = 'array')
```

For rows with `curriculum_unit_id`:

- kind defaults to `lesson`;
- state is `placeholder` when the title is still the generated generic title and no material is attached;
- path defaults to `[]`;
- application validation restricts path to at most 8 non-empty labels of at most 100 characters each.

Do not apply these defaults semantically to supplemental practice or parent-created assignments without a curriculum unit.

### `assignment_materials`

A normalized source link:

```text
assignment_id, evidence_id, family_id, role, position, created_at
```

- Primary key: assignment/evidence.
- `role`: `primary` or `supporting`.
- Composite family foreign keys to assignment and evidence.
- Add `unique (id, family_id)` to `evidence_items` if required for the composite evidence FK.
- RLS: members may select; family editors may insert/update/delete.

### `curriculum_material_suggestions`

Persist model work and parent decisions:

```text
id, family_id, assignment_id, evidence_id, requested_by,
status, model, proposed_title, proposed_kind, proposed_instructions,
proposed_minutes, proposed_path, confidence, rationale,
before_snapshot, error_code, created_at, updated_at,
reviewed_by, reviewed_at
```

- Status: `queued`, `processing`, `ready`, `applied`, `dismissed`, `failed`.
- Only one nonterminal suggestion per assignment/evidence pair; use a partial unique index.
- Cap text and JSON sizes with checks.
- Members may select; editors may create and review. Extraction processing may use the existing server-only admin client, but only after an authenticated route creates a family-scoped row.
- Never store the full raw document in this table; evidence remains the source.

### `curriculum_scope_suggestions`

Persist publisher-aware course proposals separately from single-lesson suggestions:

```text
id, family_id, curriculum_unit_id, requested_by, status,
publisher, product_name, grade_label, edition_label, isbn,
source_kind, source_evidence_ids, confidence, assumptions,
proposed_target_count, proposed_items, before_snapshot,
model, error_code, created_at, updated_at, reviewed_by, reviewed_at
```

- Status: `queued`, `processing`, `ready`, `applied`, `dismissed`, `failed`, `superseded`.
- `source_kind`: `model_prior`, `parent_evidence`, or `curated_catalog`.
- `proposed_items` is a size-capped array of at most 500 structured items: sequence number, title, kind, path, optional duration, and per-item confidence.
- `assumptions` explicitly records unknown edition/version facts and must render in the parent preview.
- A partial unique index allows only one nonterminal proposal per curriculum/source fingerprint.
- Source evidence IDs must be family-owned and represented through a normalized join table when multiple evidence sources are used; do not trust IDs embedded only in JSON.
- Applying the proposal is a parent-confirmed, transactional mapping onto stable future assignment IDs.

Add indexes for:

- assignments by `(family_id, curriculum_unit_id, scheduled_date, status, sequence_number)` with an unscheduled partial index useful to weekly planning;
- assignment materials by family/assignment/position;
- suggestions by family/assignment/status/created_at.
- course scope suggestions by family/curriculum/status/created_at and normalized identity fingerprint where useful.

## Scope

### In scope

- One new migration created with `supabase migration new generic_curriculum_scope`
- `src/lib/supabase/database.types.ts`
- `src/lib/supabase/rls.test.ts`
- `src/lib/curriculum/scope.ts` and tests (create)
- `src/lib/curriculum/material-ingestion.ts` and tests (create)
- `src/lib/curriculum/course-identity.ts` and tests (create)
- `src/lib/curriculum/scope-suggestion.ts` and tests (create)
- `src/app/api/curriculum/route.ts`
- `src/app/api/curriculum/[id]/route.ts`
- `src/app/api/curriculum/[id]/scope/route.ts` (create if separate target mutation stays clearer)
- `src/app/api/evidence/route.ts`
- `src/app/api/assignments/[id]/materials/route.ts` (create for reads/retry/review actions if appropriate)
- `src/app/onboarding/actions.ts`
- `src/app/app/actions.ts`
- `src/components/subject-setup-fields.tsx`
- `src/components/operations-workspace.tsx`
- `src/lib/data/operations.ts`
- `src/lib/assignments/first-week.ts` and tests
- `src/lib/assignments/plan-family-week.ts` and integration tests
- Minimal CSS in existing teaching/setup styles
- Focused existing E2E specs: onboarding, learner setup, operations, first week
- `plans/README.md` status after completion

### Out of scope

- Unreviewed bulk rewriting of all 100 slots. Publisher-aware and parent-evidence course proposals are in scope, but they must render assumptions/diffs and require parent confirmation.
- Automatic web crawling or fetching publisher URLs. Existing curriculum links remain parent references only.
- Copying a curriculum from one learner to another.
- Marketplace/publisher integrations, ISBN lookup, OCR infrastructure replacement, or public curriculum catalogs.
- Full tree editing for empty unit/chapter header nodes. `curriculum_path` provides grouping without making headings consume lesson count.
- Automatic application of model suggestions. Parent confirmation is required in v1.
- Reordering completed/submitted work or deleting materialized history.
- Changing grading, review, practice, or agent authority rules.
- Implementing this before Plan 006's pagination and aggregate course counts pass.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Inspect CLI | `supabase --version && supabase migration new --help` | exit 0 |
| Database reset | `pnpm db:reset` | all migrations apply |
| Generate types | `pnpm db:types` | generated types include new fields/tables |
| Scope unit tests | `pnpm exec vitest run src/lib/curriculum/scope.test.ts src/lib/assignments/first-week.test.ts` | all pass |
| Ingestion tests | `pnpm exec vitest run src/lib/curriculum/material-ingestion.test.ts` | all pass |
| Identity/scope suggestions | `pnpm exec vitest run src/lib/curriculum/course-identity.test.ts src/lib/curriculum/scope-suggestion.test.ts` | all pass |
| Planning integration | `pnpm exec vitest run src/lib/assignments/plan-family-week.integration.test.ts src/lib/supabase/rls.test.ts` | all pass |
| Focused E2E | `pnpm exec playwright test e2e/first-week.spec.ts e2e/learner-setup.spec.ts e2e/operations.spec.ts` | all pass |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full tests | `pnpm test` | all pass |
| Full E2E | `pnpm test:e2e` | all pass |
| Build | `pnpm build` | exit 0 |

Do not run the full test suite while `pnpm dev` is running, because the dev command starts a worker that can consume shared local database work.

## Suggested executor toolkit

- Read the `supabase` and `supabase-postgres-best-practices` skills before schema, RLS, index, and query work. Verify current behavior against official Supabase documentation.
- Read the local Next.js guides under `node_modules/next/dist/docs/` for App Router data mutation, route handlers, server/client boundaries, and `after()` before editing routes.
- Model structured extraction after `src/lib/assignments/draft-review.ts` and file preparation after `src/lib/agent/run-agent.ts`; do not reuse the general-purpose artifact schema.

## Steps

### Step 1: Finish and verify the pagination prerequisite

Confirm Plan 006 is marked `DONE` and inspect its final course page contract, cursor ordering, aggregate stats, and in-scope files. Run its targeted verification commands. Reconcile this plan's field selections and DTOs with the implemented Plan 006 code; do not fork its assignment pager.

**Verify**:

```bash
rg -n '^\| 006 .*\| DONE' plans/README.md
pnpm exec vitest run src/lib/data/operation-assignment-pages.test.ts
pnpm typecheck
```

Expected: Plan 006 is DONE, tests pass, and typecheck exits 0. Otherwise STOP.

### Step 2: Add schema, safe backfill, RLS, and indexes

1. Create the migration via `supabase migration new generic_curriculum_scope`.
2. Add the columns and tables in Target data model.
3. Backfill existing curriculum assignments with kind/state/path without changing IDs, sequence numbers, schedule, status, title, submissions, or reviews.
4. Set each existing curriculum's target to `greatest(100, greatest existing non-null sequence)`.
5. Insert only missing sequence numbers from 1 through the target for active/paused, non-archived curricula. Generic rows are unscheduled, planned, inherit the course's duration/attention defaults, and use the course's current `sequence_label` in the title.
6. Use the curriculum's `created_by` for backfilled placeholders and a truthful creation type. Do not fabricate a parent identity.
7. Recompute `next_sequence_number` as maximum sequence plus one.
8. Add RLS policies and grants matching the family member/editor model.
9. Add two-family tests proving cross-family material links and suggestions cannot be read or written.
10. Verify representative unscheduled-next-lesson queries use the new partial index with a realistic fixture.

The migration must be idempotent in effect when applied once and must not create duplicate `(curriculum_unit_id, sequence_number)` rows.

**Verify**:

```bash
pnpm db:reset
pnpm db:types
pnpm exec vitest run src/lib/supabase/rls.test.ts
pnpm typecheck
```

Expected: reset, generated types, RLS tests, and typecheck pass.

### Step 3: Build pure scope rules

Create `src/lib/curriculum/scope.ts` with testable rules for:

- generic title generation from course title, sequence label, and number;
- skeleton rows for target 1–500;
- path validation/normalization;
- item-kind validation;
- deciding whether a row is an untouched placeholder;
- safe target increases;
- target decreases only when every removed trailing row is unscheduled, untouched, has no material, no submission/review, and remains in initial planned state;
- selecting the next eligible unscheduled items per course without passing a lower-numbered incomplete item already scheduled for a later date;
- separating descriptive changes from schedule-sensitive duration changes;
- preserving stable IDs and immutable historical snapshots.

Test generic 100 rows, custom target, test-as-Lesson-23, hierarchy labels, gaps, already scheduled work, completed history, safe/unsafe target reduction, and multi-course ordering.

**Verify**:

```bash
pnpm exec vitest run src/lib/curriculum/scope.test.ts
```

Expected: all cases pass.

### Step 3A: Add course identity normalization and provenance rules

Create `src/lib/curriculum/course-identity.ts` with a strict course fingerprint contract:

```ts
type CourseIdentity = {
  publisher: string | null;
  productName: string | null;
  subject: string;
  gradeLabel: string | null;
  editionLabel: string | null;
  isbn: string | null;
  status: "generic" | "recognized" | "verified";
};
```

Implement deterministic normalization for parent-entered publisher/product/grade/edition/ISBN fields. Model-based recognition may suggest a fingerprint but cannot mark it verified. Only validated parent input, parent evidence, or a matching versioned curated catalog record can produce `verified`.

Create `src/lib/curriculum/scope-suggestion.ts` with:

- a strict course-level structured-output schema capped at 500 items;
- source/provenance and assumption rules;
- identity fingerprinting for idempotency/supersession;
- a diff builder mapping proposed items onto stable generic assignment IDs by sequence number;
- conflict rules that exclude completed/submitted/needs-review items and flag scheduled/enriched items for explicit review;
- confidence thresholds that affect wording, never silent application;
- edition-change behavior that supersedes the old proposal without deleting applied history.

Unit tests must cover:

- `7th grade > English > Curriculum > BJU Press` recognized with edition unknown;
- product names with publisher aliases/casing;
- edition/year and ISBN confirmation;
- two editions of the same product remaining distinct;
- model output attempting to claim a verified edition without evidence being downgraded;
- generic fallback when identity is ambiguous;
- course proposal diff over 100 stable IDs;
- protected completed/scheduled/enriched items;
- malformed/oversized proposed outlines.

Do not hardcode a purported BJU lesson list in tests. Fixtures test identity/provenance mechanics with synthetic outline items.

**Verify**:

```bash
pnpm exec vitest run src/lib/curriculum/course-identity.test.ts src/lib/curriculum/scope-suggestion.test.ts
```

Expected: all pass.

### Step 4: Make course creation create scope, not a calendar

Refactor every curriculum creation path:

1. `src/app/api/curriculum/route.ts` accepts `targetLessonCount` default 100 and no longer requires `startDate`, `weekdays`, or a batch `count` for annual scope creation.
2. Create/update the curriculum and its missing unscheduled placeholders. Do not insert `weekly_plan_items` here.
3. `src/app/onboarding/actions.ts` creates target-100 skeletons for each new course after units are inserted; retain cleanup if any step fails.
4. `replaceLearnerSubjects` creates skeletons for newly added curricula and preserves/reuses existing curricula by stable ID.
5. Add a family-scoped target mutation route. Increasing appends placeholders. Decreasing follows the pure safety rule and returns 409 with a clear explanation if any trailing item has meaningful state.
6. Keep `next_sequence_number` compatible but do not use it as the source of weekly lesson creation.
7. Audit every course creation path with `rg` so none creates dated annual assignments.

**Verify**:

```bash
pnpm exec vitest run src/lib/curriculum/scope.test.ts src/lib/assignments/first-week.test.ts
pnpm typecheck
rg -n 'startSequence|startDate|scheduleDates\(' src/app/api/curriculum/route.ts
```

Expected: tests/typecheck pass; the old annual scheduling fields are absent from the course route.

### Step 5: Refactor weekly planning to schedule existing lessons

Change `buildFirstWeekAssignments` to receive stable candidate assignments, including ID, title, sequence, kind, duration, and source metadata. It decides dates/times but never invents assignment identity, generic titles, or sequence numbers.

Change `planFamilyWeek` to:

1. query the bounded next eligible unscheduled assignments per active curriculum;
2. combine them with existing scheduled work for capacity and parent-attention planning;
3. conditionally update selected assignments from `scheduled_date = null` to the planned date/time;
4. insert matching `weekly_plan_items` rows using the same assignment IDs and enriched titles;
5. fail/retry safely if a concurrent planner already scheduled a selected row;
6. roll back or compensate without leaving an assignment scheduled but missing its placement;
7. stop inserting curriculum assignments or incrementing sequence numbers during week planning;
8. continue creating truly supplemental/parent assignments through their existing separate paths.

Prefer one RLS-safe transactional database function for conditional assignment scheduling plus placement insertion. It may be a public `security invoker` function with narrow grants; do not use a public `security definer` function.

Update tests to assert:

- stable assignment IDs survive planning;
- only the next eligible placeholders are scheduled;
- enriched title/duration are used;
- no rows are created when planning a week;
- repeated/concurrent calls do not duplicate placements;
- lower sequence numbers are not skipped;
- capacity and parent-attention behavior remain unchanged.

**Verify**:

```bash
pnpm exec vitest run src/lib/assignments/first-week.test.ts src/lib/assignments/plan-family-week.integration.test.ts
pnpm typecheck
rg -n 'from\("assignments"\)\.insert|next_sequence_number.*\+' src/lib/assignments/plan-family-week.ts
```

Expected: all tests/typecheck pass; the final search returns no weekly-planner assignment insert/increment.

### Step 6: Add material attachment and structured suggestions

Extend the evidence API with an explicit `capturePurpose = curriculum_material` contract:

1. Require an assignment ID and verify it belongs to a curriculum, the selected learner, and the authenticated family.
2. Store files in the existing private bucket and evidence tables using current type/size/rate limits.
3. Insert `assignment_materials` rows and classify them as curriculum material, not learner work.
4. Create an idempotent queued suggestion record and start a specialized processor with `after()` or the repository's durable worker pattern if Plan 006/other active work has established one.
5. Return the durable material immediately even if model configuration is absent.

Create `src/lib/curriculum/material-ingestion.ts`:

- read only the targeted course, assignment, and attached evidence;
- prepare image/PDF/text input using existing private storage patterns;
- never fetch an arbitrary reference URL;
- call the configured OpenAI model with `store: false`, bounded timeout/retry, hashed safety identifier, and a dedicated strict Zod output schema;
- output suggested title, item kind, concise teacher-facing instructions, minutes, path, confidence, rationale, and uncertainty flags;
- prohibit unsupported claims and verbatim bulk reproduction of source material;
- persist ready/failed state with a stable error code;
- make retries idempotent.

Add GET/POST/PATCH behavior under `src/app/api/assignments/[id]/materials/route.ts` as needed to list materials, retry extraction, apply/edit a ready suggestion, or dismiss it.

Apply behavior:

- lock/read the assignment and suggestion under family scope;
- reject already applied/dismissed/stale suggestions;
- on unscheduled planned assignments, apply confirmed descriptive fields and duration;
- on future scheduled planned assignments, synchronize title/instructions/kind/path to `weekly_plan_items`; apply duration only after schedule-fit validation;
- on doing/submitted/needs-review/completed assignments, retain the historical snapshot and explain why only the material was attached;
- set item state to enriched where changes apply;
- write an audit event with evidence/suggestion/assignment IDs and changed field names;
- never log or place raw source text in audit metadata.

Test no-key fallback, invalid model output, private file read, retry, stale decision, source preservation, schedule conflict, historical assignment protection, and cross-family denial.

**Verify**:

```bash
pnpm exec vitest run src/lib/curriculum/material-ingestion.test.ts src/lib/supabase/rls.test.ts
pnpm typecheck
```

Expected: all pass.

### Step 6A: Add publisher-aware course scope proposals

Add a course-level ingestion endpoint/processor using the same private evidence and structured-output safeguards as Step 6:

1. On course creation, deterministically normalize explicit publisher/product/grade/edition/ISBN fields.
2. If the course is recognizable but not verified, queue an optional model-prior proposal with `source_kind = model_prior` and explicit edition assumptions. Do not block course creation or the generic scope.
3. If the parent adds identity evidence (cover/copyright page, ISBN note, table of contents, teacher-guide excerpt), link it to the curriculum and create a new `parent_evidence` proposal that supersedes the weaker unreviewed model-prior proposal.
4. If a versioned curated catalog is added later, require an exact identity/version match before using `curated_catalog` provenance.
5. Present the proposed target count and item-by-item diff. Allow accept-all, selective acceptance, edits, dismissal, and retry.
6. Apply accepted rows transactionally to existing stable assignments. Insert additional placeholders if the accepted target grows. Do not shrink below protected history.
7. Store provenance/confidence per applied item or enough normalized source linkage to explain each resulting title later.
8. Never copy long teacher-guide content into assignment instructions. Produce concise metadata and preserve the private source link.
9. Write audit events containing proposal/course/evidence IDs, source kind, edition status, and changed field names—not proprietary source text.

Model-prompt language must state that general familiarity may be incomplete or edition-mixed, that unknown fields must remain unknown, and that the output is a proposed starting outline rather than an authoritative publisher representation.

**Verify**:

```bash
pnpm exec vitest run src/lib/curriculum/course-identity.test.ts src/lib/curriculum/scope-suggestion.test.ts src/lib/curriculum/material-ingestion.test.ts src/lib/supabase/rls.test.ts
pnpm typecheck
```

Expected: all pass.

### Step 7: Build the parent course experience

Update setup and course UI:

1. Add `Lessons this school year` with default 100 to onboarding/learner subject setup without making onboarding feel longer. Place it under course details, not as a required taxonomy exercise.
2. Accept optional publisher, product, edition/year, and ISBN details through progressive disclosure. Pre-fill what can be parsed from the free-text course name, but let the parent correct every field.
3. Replace the course drawer's `Start at`, `How many`, `First date`, and annual weekdays fields with annual target, weekly frequency, duration, attention, and an explicit `Create course` action.
4. After creation, show the generic scope immediately while publisher recognition runs independently.
5. Render recognized/unverified/verified identity states and assumptions without claiming edition certainty.
6. Provide `Use suggested outline`, `Add edition or ISBN`, and `Keep generic lessons` actions, plus a course-level evidence drop target.
7. Keep scheduling in the existing separate `Plan this week` flow.
8. On the paginated course list from Plan 006, show sequence label/number, enriched title, kind, source state, scheduled/completed state, and applicable source provenance.
9. Make every eligible row a file drop target and include an accessible `Add material` input/button with the same behavior.
10. Show upload, extraction, ready suggestion, failed/retry, applied, and dismissed states without replacing the lesson row.
11. Show a compact before/after suggestion and allow inline edits before parent confirmation.
12. After application, update the row optimistically and refresh server aggregates without resetting the selected learner/course/cursor state.
13. Do not make the entire row draggable until a separate accessible reorder operation exists; visually distinguish dropping material **onto** a lesson from reordering lesson rows.
14. For completed/submitted rows, allow source inspection/attachment but disable identity rewrite with explanatory copy.

Keep generic rows calm; 100 repeated large cards will be noisy. Reuse Plan 006 pagination rather than rendering all 100 on initial load.

**Verify**:

```bash
pnpm lint
pnpm typecheck
```

Expected: both pass.

### Step 8: Add end-to-end regression coverage

Extend the existing onboarding, learner setup, first-week, and operations specs:

1. Create a curriculum without changing the target and assert exactly 100 unscheduled assignment rows and zero new weekly placements before explicit planning.
2. Plan the week and assert existing assignment IDs are scheduled; total assignment count remains 100.
3. Assert only the next weekly-frequency count is placed and curriculum order is preserved.
4. Upload/drop a local test PDF or image onto Lesson 1; assert the material link persists independently of extraction.
5. Stub or seed a ready suggestion; accept it and assert Lesson 1 keeps its ID but gains the new title/kind/duration/path.
6. Assert the scheduled placement title stays in sync.
7. Assert a rejected duration change does not break schedule capacity and the source remains attached.
8. Assert completed history is not rewritten.
9. Increase target to 110 and assert ten placeholders are added; attempt an unsafe reduction and assert 409 plus intact history.
10. Verify a second family cannot see or mutate materials or suggestions.
11. Create a recognizable publisher/course identity without an edition; assert the generic 100 rows appear immediately and the publisher-aware proposal is labeled unverified.
12. Add synthetic edition evidence; assert the verified proposal supersedes the weaker proposal and applies only to safe future stable IDs.
13. Assert two editions of the same publisher/product never share a supposedly exact outline fingerprint.

Use file input assignment as the accessibility/reliability path and add one focused drag/drop browser case. Do not rely exclusively on coordinate drag simulation.

**Verify**:

```bash
pnpm exec playwright test e2e/first-week.spec.ts e2e/learner-setup.spec.ts e2e/operations.spec.ts
```

Expected: all selected tests pass without page/console errors.

### Step 9: Run all gates and inspect invariants

With no dev worker running:

```bash
pnpm db:reset
pnpm db:types
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
git status --short
```

Manually confirm:

- no new course creation path schedules an annual scope;
- weekly planning schedules existing stable IDs and does not insert curriculum assignments;
- all new curriculum reads/writes are family-scoped and RLS tested;
- materials are not learner submissions;
- raw sources are never logged or copied into audit metadata;
- extraction failure never deletes or hides the source;
- generic 100-row courses use Plan 006 pagination and do not restore whole-history loading;
- pre-existing unrelated working-tree changes remain intact.

## Test plan summary

### Unit

- Skeleton generation and titles for 1, 100, and custom targets.
- Generic lesson vs assessment/review/project metadata.
- Path validation and target resizing.
- Next-eligible sequence selection and concurrency boundaries.
- Strict structured extraction parsing and safe change classification.
- Publisher/product/grade/edition/ISBN normalization, provenance, assumption wording, and course-level proposal diffs.

### Integration

- Migration/backfill preserves IDs/history and fills gaps.
- Stable-ID weekly scheduling with no duplicate assignment creation.
- Material/suggestion RLS across two families.
- Apply/dismiss/retry and stale suggestion behavior.
- Schedule-fit validation and completed-history protection.

### Browser

- Default 100-lesson quick start.
- Explicit weekly planning from unscheduled scope.
- File drop and accessible file button.
- Suggestion preview/accept/edit/dismiss/retry.
- Recognized-but-unverified publisher outline and evidence-verified edition refresh.
- Stable lesson ID and synchronized future placement.
- Target increase and guarded decrease.

## Done criteria

- [ ] New curricula default to exactly 100 ordered, unscheduled curriculum assignments.
- [ ] Creating a curriculum creates zero annual `weekly_plan_items` rows.
- [ ] Existing curricula are safely backfilled without changing existing IDs, sequence, schedule, submissions, reviews, or completion history.
- [ ] Weekly planning schedules existing assignment IDs and no longer inserts curriculum assignments.
- [ ] Course target can increase safely and cannot remove meaningful trailing history.
- [ ] Test/review/project/activity metadata does not disturb the generic pacing number.
- [ ] Parent files can be dropped onto or selected for a lesson with an accessible equivalent.
- [ ] Curriculum materials have a normalized family-scoped relation and are not submission evidence.
- [ ] A saved material survives extraction failure or missing OpenAI configuration.
- [ ] Structured suggestions are source-grounded, persisted, and require parent confirmation.
- [ ] Recognizable publisher/course names may produce an optional starting outline without blocking the generic scope.
- [ ] Model familiarity alone cannot mark a course identity or outline edition-verified.
- [ ] Publisher-aware suggestions visibly state source kind, confidence, edition assumptions, and unknowns.
- [ ] Parent edition/ISBN/TOC evidence can supersede an unverified proposal without replacing stable lesson IDs or protected history.
- [ ] Applying a suggestion preserves the stable assignment ID and synchronizes a safe future placement.
- [ ] Completed/submitted history is not rewritten.
- [ ] All new tables have RLS, narrow grants, composite family integrity, and two-family tests.
- [ ] Plan 006 pagination remains in use; initial course render is bounded.
- [ ] `pnpm db:reset`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build` pass.
- [ ] `git diff --check` passes and unrelated dirty changes remain intact.
- [ ] Plan 007 is marked DONE only after every item above passes.

## STOP conditions

Stop and report instead of improvising if:

1. Plan 006 is not complete or its course pagination contract is still changing.
2. Any in-scope dirty change would be overwritten or cannot be reconciled.
3. Existing code no longer treats assignments as durable curriculum work and weekly plan items as placements.
4. Backfilling 100 placeholders per existing active curriculum would exceed a measured safe migration/runtime envelope; report actual row counts and timing before choosing another model.
5. Stable-ID scheduling cannot be made transactional or safely compensating without changing unrelated scheduling semantics.
6. A correct solution appears to require mutating submitted/completed assignment identity or deleting learning history.
7. Curriculum source material can only be represented by reusing learner submission evidence.
8. Applying duration changes would bypass existing capacity or parent-attention validation.
9. The extractor would require fetching arbitrary publisher URLs or exposing private storage publicly.
10. The only way to provide a publisher-aware outline is to claim exact edition knowledge without versioned evidence or visible assumptions.
11. Any new public-schema function would require `security definer`; do not add it without a separate private-schema security review.
12. A targeted verification fails twice after one reasonable correction.

## Maintenance notes

- The 100 count is a parent-editable default, not a universal homeschool claim. Keep it easy to change and never infer compliance from it.
- `sequence_number` is the stable pacing order; `curriculum_item_kind` and `curriculum_path` describe publisher vocabulary without changing the count.
- A later batch outline importer should produce the same material suggestions and field updates in bulk, with a parent-reviewed diff. It should not introduce a second sequence model.
- Publisher familiarity decays and editions diverge. Treat model-prior scopes as disposable proposals; versioned parent evidence or curated catalog entries are the only path to edition-verified claims.
- If true non-counting unit/chapter header nodes become necessary, add them as a separate presentation hierarchy only after validating demand; do not make them assignments or consume lesson numbers.
- Reviewers should scrutinize migration backfill volume, stable-ID scheduling concurrency, material-vs-submission semantics, RLS, raw source handling, and completed-history immutability.
