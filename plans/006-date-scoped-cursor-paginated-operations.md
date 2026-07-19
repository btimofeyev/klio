# Plan 006: Replace whole-history assignment loading with date-scoped, cursor-paginated queries

> **Executor instructions**: This file is the long-running implementation prompt. Read it completely before editing anything, then execute it step by step without stopping between ordinary milestones. Run every verification command and confirm the expected result before moving to the next step. Preserve unrelated working-tree changes. If anything in **STOP conditions** occurs, stop and report instead of improvising. When all done criteria pass, update this plan's row in `plans/README.md` to `DONE` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git status --short
> git diff --stat 758af2b..HEAD -- src/lib/data/operations.ts src/lib/data/operation-assignment-pages.ts src/app/api/assignments/route.ts src/app/app/page.tsx src/app/app/week/page.tsx src/app/app/assignments/page.tsx src/app/app/review/page.tsx src/app/app/adjustments/page.tsx src/components/operations-workspace.tsx src/app/globals.css src/app/teacher-canvas.css src/lib/supabase/database.types.ts src/lib/supabase/rls.test.ts e2e/operations.spec.ts e2e/seeded-family-week.spec.ts supabase/migrations plans/README.md
> ```
>
> This repository was already heavily dirty when this plan was written, including modifications to several in-scope files. Inspect the current diff for each in-scope file and preserve those changes. The excerpts below describe the working tree observed on 2026-07-18, not necessarily pristine `HEAD`. If an in-scope symbol no longer matches the behavior described here, treat that as a STOP condition and report the new shape.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: perf, bug, migration, tests
- **Planned at**: commit `758af2b`, 2026-07-18

## Why this matters

Every visit to a teaching surface currently walks the family's entire `assignments` table in 500-row offset pages, sends every assignment into a client component, and deliberately throws once the history reaches 5,000 rows. A three-learner homeschool family can hit that threshold in normal use, turning accumulated learning history into a workspace outage. The replacement must bound calendar reads to the visible day/week/month, keyset-paginate course history, hydrate only the assignment records referenced by review or adjustment queues, preserve exact course totals through aggregates, and keep family RLS effective throughout.

This is not complete if the 5,000-row exception is merely removed or raised. It is also not complete if a date filter is added while the UI continues changing weeks only in local React state, because navigating outside the initially loaded window would then show a false empty schedule.

## Product invariants

Preserve these behaviors while changing the data access path:

1. A parent can view all children together or one learner at a time.
2. Today, week, and month views show every assignment and calendar conflict in their displayed date range.
3. Previous/next day, week, and month navigation loads the newly selected range and preserves learner/view query parameters.
4. Course progress counts cover the entire course even though the browser only receives one assignment page at a time.
5. Draft reviews and active/undoable adjustments retain the assignment records they reference even when those assignments are outside the current calendar window.
6. `artifactId` still resolves from `weekly_plan_items`; do not rely on the unrelated 120-row `getWorkspace().scheduleItems` limit.
7. Family membership and RLS remain the authorization boundary. Do not use an admin/service client for these reads.
8. No visible list silently truncates. A bounded page must expose `nextCursor`; a visible calendar range may internally consume multiple cursor pages until the range is complete.

## Current state

### Relevant files

- `src/lib/data/operations.ts` — common loader used by all five teaching surfaces; currently performs the whole-history read and builds every DTO.
- `src/lib/data/workspace.ts` — request-cached base workspace loader. It limits `weekly_plan_items` to 120, so its `scheduleItems` cannot be used to decorate an independently scoped assignment result.
- `src/app/app/page.tsx` — Today Server Component; calls the operations loader before reading `searchParams`.
- `src/app/app/week/page.tsx` — Week/month Server Component; also calls the loader before reading the anchor date and view.
- `src/app/app/assignments/page.tsx` — course library; has no unit/cursor query contract.
- `src/app/app/review/page.tsx` and `src/app/app/adjustments/page.tsx` — queue surfaces that currently receive all assignments just to resolve a bounded set of references.
- `src/components/operations-workspace.tsx` — client UI. Calendar navigation currently changes local state, and course counts are derived from the full `assignments` array.
- `src/lib/calendar/month.ts` — existing `monthGrid(anchorDate)` and `shiftMonth(anchorDate, amount)` helpers. Reuse them; do not duplicate month arithmetic.
- `src/lib/product/workspace-insight-presentation.ts` — exports `planningProposalAssignmentIds(...)`; reuse it to find assignment references in planning proposals.
- `supabase/migrations/20260712233222_homeschool_operating_loop.sql` — assignment schema, RLS, and current indexes.
- `src/lib/supabase/rls.test.ts` — existing two-family isolation test and the pattern for authenticated Supabase clients.
- `e2e/operations.spec.ts` and `e2e/seeded-family-week.spec.ts` — existing schedule, course, learner, and navigation coverage.

### The unbounded loader

At `src/lib/data/operations.ts:18-34`, every surface calls one no-argument loader and starts the assignment scan in parallel with unrelated queues:

```ts
export async function getOperationsWorkspace() {
  const workspace = await getWorkspace();
  if (!workspace) return null;
  const supabase = await createClient();
  const familyId = workspace.family.id;
  const currentDate = dateInTimezone(new Date(), workspace.family.timezone);
  const conflictRange = calendarConflictRange(currentDate);
  const [units, assignments, submissions, reviews, adjustments,
    planningProposals, practiceSessions, conflicts] = await Promise.all([
    // ...
    loadFamilyAssignments(supabase, familyId),
    // ...
  ]);
```

At `src/lib/data/operations.ts:61-74`, the scan offsets over the whole family table and turns normal data growth into an exception:

```ts
async function loadFamilyAssignments(supabase, familyId) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await supabase.from("assignments").select("*")
      .eq("family_id", familyId)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("scheduled_time", { ascending: true, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    // ...
  }
  throw new Error("This family workspace has more scheduled work than the week view can safely load.");
}
```

At `src/lib/data/operations.ts:36-45`, assignment artifacts are resolved from the base workspace's truncated schedule list:

```ts
const placementByAssignmentId = new Map(
  workspace.scheduleItems.flatMap((item) => item.assignmentId ? [[item.assignmentId, item]] : []),
);
// ...
artifactId: placementByAssignmentId.get(item.id)?.artifactId ?? null,
```

### Calendar navigation assumes all history is already present

At `src/components/operations-workspace.tsx:546`, day navigation only changes local state:

```tsx
<button type="button"
  onClick={() => props.setSelectedDate(addDays(props.selectedDate, -1))}
  aria-label="Previous day">
```

At `src/components/operations-workspace.tsx:867`, week/month navigation does the same:

```tsx
onClick={() => props.setSelectedDate(
  props.mode === "month"
    ? shiftMonth(props.selectedDate, -1)
    : addDays(props.days[0], -7)
)}
```

At `src/components/operations-workspace.tsx:844`, “Open this week” only flips client mode, which would retain a month-scoped payload instead of requesting the target week:

```tsx
onViewWeek={() => props.setMode("week")}
```

The existing `scheduleViewHref` at lines 1023-1029 already preserves date, learner, and month view. Extend/reuse this URL contract rather than inventing a second one.

### Course progress assumes a complete in-memory history

At `src/components/operations-workspace.tsx:894-939`, course selection, totals, completion percentage, active count, and every row are computed from `props.assignments`:

```ts
const [selectedUnitId, setSelectedUnitId] = useState(props.units[0]?.id ?? null);
const visibleAssignments = selectedUnit
  ? props.assignments.filter((item) => item.curriculumUnitId === selectedUnit.id)
  : props.assignments.filter((item) => !item.curriculumUnitId);

const items = props.assignments.filter((item) => item.curriculumUnitId === unit.id);
const completed = items.filter((item) => item.status === "completed").length;
```

Pagination must therefore add aggregate stats to each curriculum unit and a page contract for the selected unit. Do not relabel a 50-row page as the course total.

### Existing database support is not aligned to the family-wide access path

The current index at `supabase/migrations/20260712233222_homeschool_operating_loop.sql:176` is:

```sql
create index assignments_family_student_schedule_idx
  on public.assignments(family_id, student_id, scheduled_date, status);
```

It is useful for learner-scoped reads but not ideal for a family-wide range ordered by schedule, because `student_id` separates `family_id` from `scheduled_date`. `assignments` already has RLS policies based on family membership. New pagination functions must be `security invoker` and must not bypass those policies.

## Framework and repository conventions

- This project uses Next.js `16.2.10`, React 19, TypeScript, Supabase, Vitest, and Playwright.
- Before editing framework code, read these checked-in Next.js guides completely:
  - `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- Pages receive `searchParams` as a Promise. Await and validate them before invoking a surface-scoped loader.
- Keep authenticated mutable family data in ordinary request-scoped reads. Do not add `use cache` or shared/public caching. The existing React `cache(...)` in `getWorkspace` is request memoization and may remain.
- API request validation uses strict Zod schemas and `NextResponse`; model the new GET route after `src/app/api/curriculum/route.ts` and existing authenticated API routes.
- Supabase migrations must be created with `supabase migration new <name>`; never invent a timestamped filename.
- Public-schema database functions must use caller privileges/RLS (`security invoker`), fully qualified object names, and a fixed empty search path. Revoke default execution and grant only the roles that need it.
- Use explicit select column lists. Do not restore `.select("*")` in application queries.
- Use keyset/cursor pagination, never `OFFSET`, `.range(offset, ...)`, or page-number pagination for assignment history.
- Reuse `monthGrid`, `shiftMonth`, `planningProposalAssignmentIds`, the existing DTO naming style, and existing Supabase client factories.
- Existing commits use short imperative messages such as `Add bounded autonomous homeschool workflows`. Use a similarly scoped message if the operator asks for a commit.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect CLI | `supabase --version && supabase migration new --help && supabase db --help` | exit 0; confirms installed syntax before migration work |
| Start database | `pnpm db:start` | exit 0; local Supabase healthy |
| Reset migrations | `pnpm db:reset` | exit 0; every migration and seed applies |
| Generate types | `pnpm db:types` | exit 0; `database.types.ts` includes the new RPCs |
| Targeted unit tests | `pnpm exec vitest run src/lib/data/operation-assignment-pages.test.ts` | all tests pass |
| Targeted integration tests | `pnpm exec vitest run src/lib/data/operation-assignment-pages.integration.test.ts src/lib/supabase/rls.test.ts` | all tests pass |
| Targeted browser tests | `pnpm exec playwright test e2e/operations.spec.ts e2e/seeded-family-week.spec.ts` | all selected tests pass |
| Lint | `pnpm lint` | exit 0, no errors |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full unit/integration suite | `pnpm test` | all tests pass |
| Full browser suite | `pnpm test:e2e` | all tests pass |
| Production build | `pnpm build` | exit 0 |

Do not run `pnpm test` while `pnpm dev` is running: the dev command also starts an agent worker that can consume shared local database jobs and make integration tests nondeterministic. Stop only a development process you started yourself.

## Suggested executor toolkit

- Invoke the `supabase` skill before changing migrations, RLS, RPCs, or Supabase queries. Verify current RPC and JavaScript client behavior against current official Supabase docs before implementation.
- Invoke the `supabase-postgres-best-practices` skill for the keyset predicates, composite indexes, and `EXPLAIN (ANALYZE, BUFFERS)` review.
- Do not install a new pagination or date library. Existing dependencies and date helpers are sufficient.

## Scope

### In scope

- `src/lib/data/operations.ts`
- `src/lib/data/operation-assignment-pages.ts` (create)
- `src/lib/data/operation-assignment-pages.test.ts` (create)
- `src/lib/data/operation-assignment-pages.integration.test.ts` (create if the existing integration harness supports it; otherwise put the database cases in `src/lib/supabase/rls.test.ts`)
- `src/app/api/assignments/route.ts` (create the authenticated GET pager; do not disturb `[id]/route.ts`)
- `src/app/app/page.tsx`
- `src/app/app/week/page.tsx`
- `src/app/app/assignments/page.tsx`
- `src/app/app/review/page.tsx`
- `src/app/app/adjustments/page.tsx`
- `src/components/operations-workspace.tsx`
- `src/app/globals.css` and/or `src/app/teacher-canvas.css` only for pagination/loading/disabled states that cannot reuse current styles
- One new migration created by the CLI
- `src/lib/supabase/database.types.ts`
- `src/lib/supabase/rls.test.ts`
- `e2e/operations.spec.ts`
- `e2e/seeded-family-week.spec.ts`
- `plans/README.md` status only after completion

### Out of scope

- `src/lib/data/workspace.ts` broad base-workspace refactoring. Its other bounded reads are a separate concern; only stop depending on its truncated `scheduleItems` for assignment decoration.
- Agent snapshots, weekly briefing generation, records/export pages, or proactive worker query optimization. They use different bounded/analytical access paths.
- Assignment mutation semantics, grading rules, adjustment approval logic, agent authority, or family RLS policy meaning.
- A visual redesign of the teaching surfaces.
- Infinite scroll. Use an explicit, accessible “Load more lessons” control.
- New dependencies, caching infrastructure, realtime subscriptions, background prefetching, or service-role reads.
- Deleting historical assignments, archiving family records, or raising/replacing the 5,000 limit with another global hard cap.

## Git workflow

- Suggested branch when the working tree is clean enough to branch safely: `advisor/006-date-scoped-assignment-queries`.
- Preserve all pre-existing dirty changes. Never reset, checkout, or overwrite them.
- Commit per logical unit only if the operator asked for commits: database/query primitives; route/page wiring; client UX/tests.
- Do not push or open a PR unless explicitly instructed.

## Target design

### 1. Surface-scoped loader contract

Replace `getOperationsWorkspace()` with a discriminated request contract. Names may vary slightly, but the behavior must match:

```ts
type OperationsWorkspaceRequest =
  | { surface: "today"; anchorDate?: string }
  | { surface: "week"; anchorDate?: string; calendarMode: "week" | "month" }
  | { surface: "assignments"; studentId?: string; curriculumUnitId?: string }
  | { surface: "review" }
  | { surface: "adjustments" };
```

The loader obtains `currentDate` from the family timezone, validates/falls back the requested date and learner/unit against the loaded workspace, computes a scope, and returns only the assignments needed by that surface. Prefer returning resolved selections (`selectedDate`, `selectedStudentId`, `selectedCurriculumUnitId`) alongside the DTO so Server Components and the client cannot disagree.

Date scopes are exact and inclusive:

- Today: `from = to = anchorDate`.
- Week: Monday through Sunday containing `anchorDate`. The UI may display only enabled learning days, but the database boundary remains the full calendar week.
- Month: first and last dates returned by `monthGrid(anchorDate)`, including adjacent-month days visible in the grid.
- Assignments/review/adjustments: no broad scheduled-date query.

`calendar_conflicts` must use the same date window for Today/Week/Month and return `[]` for non-calendar surfaces. Remove the current approximately two-year `calendarConflictRange(currentDate)` read.

### 2. Cursor contracts

Use opaque base64url JSON cursors, versioned so the server can reject stale/invalid shapes without exposing raw query syntax. Implement encode/decode only in `src/lib/data/operation-assignment-pages.ts`; validate decoded fields strictly with Zod.

- Scheduled cursor payload: `{ v: 1, date: "YYYY-MM-DD", time: "HH:MM:SS" | null, id: UUID }`.
- Curriculum cursor payload: `{ v: 1, sequence: integer | null, id: UUID }`.
- Page size: 100 for scheduled internal pages and 50 for browser course pages. The API may accept `limit`, but clamp it to `1..100`.
- Request `limit + 1` rows, return at most `limit`, and derive `nextCursor` from the last returned row only when another row exists.
- Invalid cursors produce HTTP 400 in the API and a controlled first-page fallback only at the Server Component boundary. Do not pass cursor fragments directly into PostgREST filter strings.

Scheduled calendar loading may loop through cursor pages until the date window is exhausted, because the range itself is bounded. Course history must return one page at a time to the browser and expose `nextCursor`; never loop through the whole course during initial render.

### 3. Database access primitives

Create the migration with:

```bash
supabase migration new date_scoped_assignment_pagination
```

Implement these indexes (names may match these exactly):

```sql
create index assignments_family_scheduled_cursor_idx
  on public.assignments(family_id, scheduled_date, scheduled_time, id)
  where scheduled_date is not null;

create index assignments_family_curriculum_cursor_idx
  on public.assignments(family_id, curriculum_unit_id, sequence_number, id)
  where curriculum_unit_id is not null;
```

Implement three `public` SQL functions with `language sql stable security invoker set search_path = ''`:

1. `list_scheduled_assignments_page(...) returns setof public.assignments`
   - Required filters: `family_id`, inclusive `from`/`to` dates.
   - Optional learner filter only if the final UX reloads on learner change; otherwise read all learners in the bounded window.
   - Stable order: `scheduled_date asc, scheduled_time asc nulls last, id asc`.
   - Keyset predicate must correctly handle a null `scheduled_time`: after a non-null time come later times, then null-time rows; after a null-time row come only greater IDs among null-time rows or later dates.
   - Clamp limit to `1..101` so application code can request one look-ahead row.

2. `list_curriculum_assignments_page(...) returns setof public.assignments`
   - Required filters: family and curriculum unit. Optional student must agree with the selected unit if supplied.
   - Stable order: `sequence_number asc nulls last, id asc`.
   - Keyset predicate must correctly handle null sequence numbers: after a numbered assignment come higher sequence numbers and then null-sequence rows; after a null-sequence row come only greater IDs among null-sequence rows.
   - Clamp limit to `1..101`.

3. `curriculum_assignment_stats(...)` returning one row per non-archived curriculum unit in the requested family (and optional learner): `curriculum_unit_id`, `assignment_count`, `completed_count`, and `active_count`. Define active exactly as the existing UI does: status is neither `completed` nor `skipped`.

For all three functions:

- Fully qualify every table/type reference.
- Let RLS apply; do not use `security definer`.
- `revoke execute ... from public, anon;` and `grant execute ... to authenticated, service_role;` using exact signatures.
- Do not modify existing assignment RLS policies.
- Validate family/unit/student relationships in the SQL filters, not only in the client.

After applying the migration locally, run `EXPLAIN (ANALYZE, BUFFERS)` with a representative family/date/unit fixture. Confirm the scheduled query uses `assignments_family_scheduled_cursor_idx` and the course query uses `assignments_family_curriculum_cursor_idx` once statistics are representative. If the planner chooses a sequential scan only because the fixture is tiny, add enough transient rows for a meaningful plan before changing indexes.

### 4. Assignment decoration and targeted references

Use one explicit assignment column list shared by scheduled and course queries. After rows are known:

- Fetch `weekly_plan_items(assignment_id, artifact_id)` only for the returned assignment IDs, in bounded chunks if necessary. Build `artifactId` from this result, not `workspace.scheduleItems`.
- Resolve attention using the already loaded curriculum unit data exactly as today.
- Deduplicate assignments by ID before DTO conversion and keep the requested stable order.

For queue and calendar side-context:

- Review: fetch draft reviews first, then submissions by the review submission IDs and assignments by the review assignment IDs.
- Adjustments: fetch the current proposed adjustments and applied-but-unacknowledged/undo-available records needed by the existing UI, then assignments referenced by `adjustment_actions.assignment_id`.
- Planning proposals: retain the bounded proposed/applied records used by the UI; collect IDs with exported `planningProposalAssignmentIds(...)` plus `target_assignment_id`.
- Today/week insight cards: collect only documented assignment references from active insight action refs/evidence refs. Do not recursively treat every UUID in arbitrary JSON as an assignment ID.
- Merge those bounded referenced assignments with scheduled assignments so decision cards and review summaries continue to render even when their records fall outside the visible calendar range.

The fetch order can no longer be one giant `Promise.all`, because assignment IDs depend on reviews/proposals. Use two bounded phases: independent base/queue reads, then targeted assignment/submission/placement hydration. Parallelize within each phase.

### 5. Course page contract

Extend `CurriculumUnitDTO` with aggregate values rather than deriving them from the current page:

```ts
assignmentCount: number;
completedCount: number;
activeCount: number;
```

Add page metadata to the workspace DTO, for example:

```ts
assignmentPage: {
  curriculumUnitId: string | null;
  nextCursor: string | null;
} | null;
```

`/app/assignments` accepts `student` and `unit` search params. Validate UUID syntax, then validate membership against loaded students/units. Select the first unit in the chosen learner scope when `unit` is absent or inaccessible. The initial Server Component response fetches only the first 50 assignments for that unit.

Create `GET /api/assignments` for explicit “Load more lessons” behavior:

- Strict query schema: `familyId`, `curriculumUnitId`, optional cursor, optional limit.
- Require an authenticated parent with `requireParentApi()`.
- Verify family membership and that the unit belongs to that family before calling the pager. RLS remains a second line of defense.
- Return `{ assignments, nextCursor }` with the same decorated `AssignmentDTO` shape used by the Server Component.
- Return 400 for malformed input/cursors, 403 for family access failure, 404 for a missing/inaccessible unit, and a generic 500 message for unexpected errors.

In `AssignmentsSurface`:

- Initialize the selected unit from the loader's resolved unit, not `props.units[0]` unconditionally.
- Changing a course or learner navigates to `/app/assignments?student=...&unit=...` so the server loads that unit's first page. Do not show stale rows while swapping units.
- Render course progress from aggregate DTO fields.
- Render active count from `selectedUnit.activeCount`, not the current page.
- Maintain appended pages in local state, deduplicated by assignment ID.
- “Load more lessons” calls the GET route with the current `nextCursor`, disables while loading, appends results, and updates the cursor. Hide it when `nextCursor` is null.
- After adding curriculum or changing an assignment, preserve the selected unit query parameters across `router.refresh()`.
- Add an accessible error/status message when another page fails; keep already loaded rows visible and allow retry.

### 6. URL-driven calendar navigation

Update Today and Week/month pages to await and syntactically validate `searchParams` before calling `getOperationsWorkspace(request)`. Pass the resolved anchor/view from the returned workspace to `OperationsWorkspace`.

Replace only range-changing client state operations with URL navigation:

- Previous/next day: navigate to `/app?date=<new-date>&student=<scope-if-specific>`.
- Today: navigate to the family's `currentDate`, not the browser's UTC date.
- Previous/next week: navigate to `/app/week?date=<new-anchor>&student=<scope-if-specific>`.
- Previous/next month: same route with `view=month`.
- Week/month toggle: navigate through `scheduleViewHref`; switching modes must request the corresponding range.
- “Open this week” from month: navigate to week mode for the selected date.
- Selecting a day inside the already loaded week/month may remain local state because that date is within the payload.

Use `router.push(...)` or `<Link>` as appropriate and expose a disabled/pending state if navigation is not immediate. Preserve the current learner and do not create duplicate history entries for internal mode toggles unless that matches existing Next navigation conventions.

## Steps

### Step 1: Establish the verification baseline and protect existing work

1. Run the drift commands and inspect `git diff -- <each in-scope dirty file>`.
2. Read the three local Next.js guides named above.
3. Invoke/read the Supabase skills and current official documentation for SQL RPCs, RLS behavior in invoker functions, generated RPC types, and PostgREST/Supabase pagination.
4. Run the narrow existing baseline:

```bash
pnpm typecheck
pnpm exec playwright test e2e/operations.spec.ts e2e/seeded-family-week.spec.ts
```

If a baseline failure is unrelated to this plan, record the exact test/error and continue only if the requested surface can still be verified independently. If it touches operations data, calendar navigation, course counts, or family isolation, STOP.

**Verify**: commands exit 0, or any unrelated pre-existing failure is documented before edits.

### Step 2: Add pure range and cursor contracts with unit tests

Create `src/lib/data/operation-assignment-pages.ts` with:

- explicit assignment select columns;
- page constants;
- strict cursor schemas and base64url encode/decode helpers;
- `operationsDateRange(surface, anchorDate)` using `monthGrid` for month and UTC-safe Monday/Sunday arithmetic for week;
- small pure helpers for page look-ahead and deduplication if useful;
- server-only boundary if it imports Supabase; keep pure date/cursor helpers in a testable module if `server-only` interferes with Vitest.

Create `src/lib/data/operation-assignment-pages.test.ts` covering:

- today exact range;
- week ranges when the anchor is Monday, Sunday, and across year/month boundaries;
- month grid range including adjacent-month days and leap February;
- scheduled cursor round trip for null and non-null time;
- course cursor round trip for null and numbered sequence;
- malformed base64, malformed JSON, wrong version, invalid date/time/UUID, and oversized payload rejection;
- `limit + 1` behavior and no duplicate boundary row.

**Verify**:

```bash
pnpm exec vitest run src/lib/data/operation-assignment-pages.test.ts
pnpm typecheck
```

Expected: all new tests pass and typecheck exits 0.

### Step 3: Add indexed RLS-safe database pagination

1. Discover CLI syntax with the commands in the command table.
2. Create one migration through `supabase migration new date_scoped_assignment_pagination`.
3. Add the two indexes and three invoker functions described in Target design.
4. Reset the local database and generate types.
5. Add RLS tests using two families:
   - family A can page only family A scheduled and course rows;
   - asking an A-authenticated client for family B returns zero rows, not B data;
   - stats omit family B;
   - anon cannot execute the functions;
   - cursor boundary rows do not repeat across calls;
   - null scheduled times and null sequence numbers appear once in correct order.
6. Run representative `EXPLAIN (ANALYZE, BUFFERS)` checks and save the command/output in the implementation handoff; do not commit bulky explain artifacts.

**Verify**:

```bash
pnpm db:reset
pnpm db:types
pnpm exec vitest run src/lib/supabase/rls.test.ts
pnpm typecheck
```

Expected: migrations reset cleanly, generated types expose all three functions, isolation tests pass, and typecheck exits 0.

### Step 4: Implement surface-scoped assignment loading

Refactor `src/lib/data/operations.ts` and use the new helper module:

1. Add the discriminated request type and resolved scope metadata.
2. Replace `loadFamilyAssignments` with the scheduled-page loop and course one-page loader.
3. Restructure reads into dependency phases so review/proposal IDs are available before assignment hydration.
4. Make Today/Week/Month read only their visible scheduled window plus bounded referenced assignments.
5. Make Assignments read only one selected course page plus aggregate unit stats.
6. Make Review/Adjustments read only referenced assignments.
7. Scope conflicts to the calendar range and return none on non-calendar surfaces.
8. Fetch placement artifacts for only loaded assignment IDs.
9. Keep DTO conversion and attention resolution behavior intact.
10. Remove `loadFamilyAssignments`, its offset loop, `.select("*")`, the 5,000 exception, `calendarConflictRange`, and `workspace.scheduleItems`-based artifact mapping.

Add database-backed regression tests with transient data:

- Create a family with more than 5,000 historical assignments, mostly outside a selected week, plus assignments inside it. Prefer bulk inserts in batches; cleanup by deleting the transient family so cascades remove rows.
- Assert the week loader succeeds and returns in-range rows plus only explicitly referenced out-of-range rows—not the history.
- Assert month and day boundaries are inclusive and exact.
- Create at least 125 assignments in one curriculum unit and verify three course pages have 50/50/25 rows, stable ordering, no overlaps, and null final cursor.
- Verify course totals remain 125 regardless of page size.
- Verify an out-of-window reviewed/adjusted assignment is hydrated for its queue.
- Verify an assignment beyond the first 120 plan items still receives its `artifactId` from targeted `weekly_plan_items` lookup.

**Verify**:

```bash
pnpm exec vitest run src/lib/data/operation-assignment-pages.test.ts src/lib/data/operation-assignment-pages.integration.test.ts
pnpm typecheck
rg -n 'loadFamilyAssignments|more scheduled work than|range\(offset|select\("\*"\)' src/lib/data/operations.ts src/lib/data/operation-assignment-pages.ts
```

Expected: tests pass; typecheck exits 0; the final `rg` returns no matches.

### Step 5: Wire Server Components and the course GET route

1. Update all five Server Components to pass the correct surface request.
2. Today and week pages must parse date/view before loading.
3. Assignments page must parse student/unit before loading and pass the resolved selected unit to the client.
4. Create the authenticated GET route and reuse the same course-page/decorating code as the initial loader; do not fork cursor logic or DTO mapping.
5. Add route-level integration cases for authentication, validation, family/unit mismatch, first page, next page, end of list, and malformed cursor.

**Verify**:

```bash
pnpm typecheck
pnpm exec vitest run src/lib/data/operation-assignment-pages.test.ts src/lib/data/operation-assignment-pages.integration.test.ts
```

Expected: all pass; no page calls a no-argument `getOperationsWorkspace()`.

### Step 6: Make the client honest about scoped data

Update `src/components/operations-workspace.tsx`:

1. Replace range-changing calendar state with URL navigation as specified.
2. Preserve local selection only within the currently loaded range.
3. Convert course selection to URL-backed server selection.
4. Use aggregate course counts and progress.
5. Add explicit load-more state, dedupe, retry, and end-of-list behavior.
6. Ensure assignment update/add flows refresh or update the current course page without resetting to the first unrelated unit.
7. Preserve family/learner labels and accessibility names.
8. Add only minimal CSS needed for new controls and pending/error states.

Add focused component tests if the component test harness can cover the pager without brittle full-workspace fixtures. At minimum test pure pager merge/state helpers in the data test and cover the rendered workflow in Playwright.

**Verify**:

```bash
pnpm lint
pnpm typecheck
```

Expected: both exit 0.

### Step 7: Add browser regression coverage

Extend existing Playwright tests rather than creating a redundant broad spec:

1. Seed enough old assignments to prove the page remains usable beyond 5,000 total family rows. Use direct admin inserts in batches and reliable `finally` cleanup; do not render all rows.
2. Visit Today at an anchor date and click previous/next. Assert the URL date changes and the destination day's unique assignment appears.
3. Visit Week, navigate next/previous week, and assert destination rows; repeat for month with `view=month` preserved.
4. From month select a day and open its week; assert `view=month` is removed and the chosen week data appears.
5. Switch family/learner scope and assert the query parameter and correct rows remain.
6. In Assignments, assert the aggregate says e.g. `125 total` while only 50 rows render initially; click “Load more lessons” twice and assert 100 then 125 unique rows with the control removed at the end.
7. Switch units and learners; assert rows and counts do not leak from the previous selection.
8. Verify draft review and active adjustment cards still name out-of-window assignments.

Avoid a single test that inserts 5,000 rows once per browser case. Seed once within one serial test/fixture and exercise the related assertions before cleanup.

**Verify**:

```bash
pnpm exec playwright test e2e/operations.spec.ts e2e/seeded-family-week.spec.ts
```

Expected: selected browser tests pass without console/page errors.

### Step 8: Run final gates and review query bounds

With no dev worker running, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
rg -n 'loadFamilyAssignments|more scheduled work than|range\(offset|for \(let offset' src/lib/data src/app/app src/app/api/assignments
git diff --check
git status --short
```

Review the final diff manually and confirm:

- no source file outside Scope changed because of this plan;
- no pre-existing dirty hunk was discarded;
- no assignment read on the teaching surfaces lacks either a date range, a bounded ID set, or a cursor limit;
- every list with a page limit exposes a next cursor instead of truncating;
- all database functions are invoker/RLS-safe and grants are narrow;
- no service secret/admin client enters the read path;
- the browser payload contains a visible window or one course page, never whole assignment history.

Expected: all commands pass; the old-pattern `rg` returns no matches; `git diff --check` is clean.

## Test plan summary

### Unit

- Range calculation across day/week/month, month/year/leap boundaries.
- Cursor encoding/decoding, versioning, validation, null sort fields, look-ahead behavior, and dedupe.

### Database/integration

- Stable scheduled and curriculum keyset ordering across page boundaries.
- Correct handling of null scheduled time and sequence number.
- Aggregate totals independent of page size.
- Two-family RLS isolation and anon execution denial.
- Regression family with >5,000 historical assignments.
- Targeted review/adjustment hydration and placement artifact lookup beyond base-workspace limits.

### Browser

- URL-driven day/week/month navigation and range reloads.
- Learner/view parameter preservation.
- Explicit course load-more workflow and exact aggregate counts.
- Unit/learner switching without stale rows.
- Review/adjustment cards for out-of-window assignments.

## Done criteria

All items must hold:

- [ ] `getOperationsWorkspace` requires a surface request; all five pages pass one.
- [ ] Today loads one date, Week loads one Monday-Sunday range, and Month loads exactly its visible grid range.
- [ ] Review and Adjustments hydrate assignments only through bounded references.
- [ ] Course library initial render contains at most 50 assignments and exposes an opaque next cursor when more exist.
- [ ] “Load more lessons” appends without duplicates and ends at a null cursor.
- [ ] Course total/completed/active counts come from aggregates, not the current page.
- [ ] Calendar range changes trigger URL/server navigation and preserve learner/view state.
- [ ] Assignment artifacts are resolved from targeted placement rows, not the 120-row base schedule list.
- [ ] No teaching-workspace assignment query uses offset pagination or whole-history accumulation.
- [ ] No 5,000-row exception remains.
- [ ] A >5,000-history regression fixture passes.
- [ ] New SQL functions are `security invoker`, use RLS, and deny anon execution.
- [ ] Composite indexes support both cursor access paths and representative explain plans are reviewed.
- [ ] `pnpm db:reset`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build` exit 0.
- [ ] `git diff --check` exits 0.
- [ ] Pre-existing unrelated changes remain intact.
- [ ] `plans/README.md` marks Plan 006 `DONE` only after every gate passes.

## STOP conditions

Stop and report; do not improvise if any occurs:

1. Any in-scope working-tree change would be overwritten or cannot be cleanly reconciled with this plan.
2. The live operations loader or component no longer matches the behaviors/excerpts in Current state.
3. Current official Supabase behavior shows `security invoker` RPC calls do not apply assignment RLS as assumed in this project's Postgres/Supabase version.
4. Correct keyset ordering requires changing assignment schema semantics, deleting history, or making `sequence_number` non-null for existing data.
5. Course totals cannot be computed under RLS without a privileged function. Do not switch to `security definer` or an admin client; report the blocker.
6. The implementation would require changing agent authority, assignment mutation semantics, grading, or adjustment approval rules.
7. A surface needs arbitrary recursive IDs from unvalidated JSON to render correctly; report the exact proposal/insight shape before broadening the extractor.
8. The >5,000 regression test cannot be isolated/cleaned up safely in the existing local test harness.
9. An existing operations/RLS baseline fails before edits. Repeated verification failures after implementation are not an automatic stop: diagnose each distinct failure, make bounded corrections, and continue through the final gates unless another STOP condition is reached.
10. The final implementation silently caps a visible calendar range without a cursor continuation path.

## Maintenance notes

- Any new assignment-backed teaching surface must declare one access mode: visible date range, bounded referenced IDs, or cursor page. A no-argument “load the family assignments” helper should not return.
- Keep cursor sort order and composite index column order synchronized. Changing one without the other can reintroduce slow scans or duplicate/missing boundary rows.
- Cursors are opaque implementation details, not durable bookmarks. Bump the cursor version when fields or ordering change and reject old versions safely.
- If assignment rows are deleted or sort fields mutate between page requests, keyset pagination remains best-effort; dedupe client-side and never promise snapshot isolation across a long browsing session.
- Reviewers should scrutinize null-order predicates, RPC grants, cross-family tests, URL navigation outside the initial range, and course totals after pagination.
- The broader `getWorkspace()` payload and bounded analytical/agent queries are intentionally deferred. This plan fixes the teaching-workspace outage without turning into a repository-wide data-layer rewrite.
