# Plan 001: Establish the homeschool agent MVP

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: This directory is the Klio product repository. Before beginning implementation, inspect its existing structure and tooling; treat a material conflict with this plan as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (multi-week MVP)
- **Risk**: HIGH — handles private family and child learning records
- **Depends on**: none
- **Category**: direction
- **Planned at**: unversioned wiki workspace, 2026-07-10

## Why this matters

Klio is a capture-first agent workspace for homeschool families. Its primary interface is an always-available parent inbox where a family can drop a worksheet photo, grade, note, voice capture, book, activity, or file. Klio maintains a durable, evidence-backed understanding of each learner, then lets the parent invoke a capable homeschool agent to turn that context into useful work: student context, a suggested next action, weekly plans, lesson materials, summaries, and safe structured practice. It must produce useful editable artifacts rather than generic chat answers. The first release must earn trust through clear source links, parent approval of agent interpretations and record changes, strict per-family isolation, and a narrow repeatable loop before it adds autonomous browser actions or a broad curriculum.

## Current state

- This repository, `/home/ben/Desktop/klio`, currently contains the Klio product plan rather than an application. The plan uses the key product pattern: immutable raw sources, maintained canonical records, durable syntheses, a global index, and an append-only audit log.
- Preserve this vocabulary in the product: **evidence**, **learning record**, **observation**, **approval**, and **audit event**.

Use these architectural decisions unless a STOP condition applies:

- **Client**: Next.js App Router, TypeScript, React, Tailwind CSS, and shadcn/ui. Build a responsive web app/PWA; do not build native mobile apps in this plan.
- **Primary experience**: Capture-first rather than chat-first. Put a multimodal parent input box/inbox on the home screen for notes, photos, voice clips, files, and grades. The agent operates on selected inbox items plus durable family context; do not make a general-purpose conversation UI the primary product.
- **Identity, data, and files**: Supabase Auth, Postgres, and private Storage buckets. Use Row Level Security (RLS) on every exposed product table and Storage policy. A family member may access only their own family records.
- **Agent**: OpenAI Responses API called only from server-side code. The agent must use function tools with schema-validated arguments. It must never write arbitrary database content directly or receive database credentials.
- **Background work**: Begin with a local in-app job runner for asynchronous image ingestion, agent processing, and CSV validation. Adopt Trigger.dev for durable production retries, scheduled reminders, and later connector syncs; do not install it until the local workflow is proven.
- **Payments and operations**: Stripe subscriptions are in scope. Defer Sentry and PostHog until deployment preparation; when added, disable analytics/session replay on screens displaying student documents or records.
- **Gradebook connections**: out of scope for the initial release. Model the connection and import records now, but ship only manual grade input and parent-uploaded CSV in this plan. Official API/OAuth is the next preferred integration; browser automation is a later supervised fallback.

## Commands you will need

Run these from `/home/ben/Desktop/klio`. This is a greenfield application setup; the commands are the required project scripts to add to `package.json`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install dependencies | `pnpm install` | exit 0 |
| Start local app | `pnpm dev` | local Next.js URL is shown; parent login page loads |
| Static checks | `pnpm lint` | exit 0, no errors |
| Type checks | `pnpm typecheck` | exit 0, no TypeScript errors |
| Unit/integration tests | `pnpm test` | exit 0, all Vitest tests pass |
| Browser tests | `pnpm test:e2e` | exit 0, all Playwright tests pass |
| Production build | `pnpm build` | exit 0 |

## Suggested executor toolkit

- Use the `supabase` skill, if available, when configuring Auth, database migrations, Storage, RLS, or server-side secrets. Enable RLS on every exposed table; never expose a Supabase service-role key to the browser.
- Use the `openai-docs` skill, if available, before selecting a current API model or implementing Responses API tool calls. Do not hardcode model names from this plan.
- Use the `frontend-skill` or `design-taste-frontend` skill, if available, for the parent and student-facing UI. The initial UI should be calm, dense enough for planning, and never look like a generic chat demo.
- Consult [Supabase data security guidance](https://supabase.com/docs/guides/database/secure-data), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), and [OpenAI model documentation](https://developers.openai.com/api/docs/models) before implementation.

## Scope

**In scope**:

- The Klio application in this repository, `/home/ben/Desktop/klio`.
- Parent authentication and family membership.
- A multimodal parent capture inbox and an agent workspace that acts on selected evidence and family context to create editable artifacts.
- Student records, raw evidence capture, source-backed skill observations, approvals, weekly plans, basic CSV grade import, audit history, and one structured student-practice renderer.
- A responsive parent web/PWA experience and a simple student session route that does not require a separate child account.
- Server-side agent tools, queues, tests, observability, and a deployment-ready security baseline.

**Out of scope**:

- Native iOS/Android apps.
- Direct child chat, social features, advertising, public sharing, classroom/co-op multi-tenancy, or a full curriculum marketplace.
- Direct HomeschoolHub login, stored website passwords, browser automation, background autonomous external actions, and automatic grade submission.
- Claims of legal compliance by state, diagnostic/clinical educational claims, or automated placement decisions.
- Generating arbitrary executable HTML/JavaScript for student activities. The agent may select content and parameters only; the product must render known, tested activity components.

## Git workflow

- Initialize a new private Git repository in `/home/ben/Desktop/klio` before coding.
- Branch naming: `feat/<short-scope>` and `fix/<short-scope>`.
- Use Conventional Commit-style messages, e.g. `feat(evidence): add worksheet capture approval flow`.
- Commit after each independently testable vertical slice. Do not push, deploy, or create a public repository unless the operator explicitly instructs it.

## Steps

### Step 1: Scaffold the app and establish the security baseline

Initialize this Klio directory as a Next.js/TypeScript repository with pnpm, ESLint, Prettier, Vitest, Playwright, Tailwind, and shadcn/ui. Add a README that names the product as a parent-operated homeschool agent workspace and documents the local setup commands and required environment variable *names only*. Add `.env.example`; it may list `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, and observability keys, but never includes values.

Add server/client separation rules:

- All OpenAI calls, service-role Supabase access, Stripe calls, and connector code run on the server only.
- Add a centralized `lib/auth/require-parent.ts` helper for server routes/actions. Do not duplicate authorization checks ad hoc.
- Add a centralized `lib/audit/write-audit-event.ts` helper. It records actor, family, action type, affected entity, timestamp, and non-sensitive metadata.
- Add a privacy page stub that plainly states the initial data categories, export/delete intent, and that the product does not use data for advertising.

**Verify**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → all commands exit 0. `rg -n "SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|STRIPE_SECRET_KEY" . --glob '!*.example' --glob '!README.md'` → reports no hard-coded key values.

### Step 2: Create the family-learning schema and access policies

Create versioned Supabase migrations, never dashboard-only schema changes. Create these tables with UUID primary keys, created/updated timestamps, explicit foreign keys, and RLS enabled:

- `families` — private family workspace.
- `family_members` — parent user membership and owner/editor role. Do not use editable client metadata for authorization.
- `students` — learner display name, birth-year optionality, learning preferences, active status. Keep only minimum personal data.
- `evidence_items` — immutable parent-provided record: kind (`photo`, `note`, `grade`, `book`, `activity`, `csv_import`), source timestamp, raw text if supplied, private storage path if supplied, creator, and import provenance.
- `skill_observations` — structured agent or parent interpretation linked to one or more `evidence_items`: subject, skill key, status (`emerging`, `developing`, `secure`, `needs-review`), confidence, rationale, provenance, and approval status (`draft`, `approved`, `rejected`).
- `weekly_plans` and `weekly_plan_items` — draft/approved plan artifacts with schedule and student links.
- `practice_sessions` and `practice_results` — agent-authored structured activity specifications, completion data, and no free-form executable content.
- `imports` — CSV imports plus row-level validation results.
- `agent_runs`, `approval_requests`, and `audit_events` — trace why agent work occurred, requested changes, parent decision, and the resulting entities.

Create a private Storage bucket `family-evidence`; paths must begin with a family UUID. Write policies so authenticated family members can access only their own family prefix. Do not expose direct public object URLs. The browser may use short-lived signed upload/download URLs only after server authorization.

The practical policy invariant is: a signed-in parent can read/write data only when a `family_members` row connects `auth.uid()` to the row’s `family_id`; no client may read another family’s student, evidence, or document even if it guesses an ID.

**Verify**: Apply migrations to a local/dev Supabase project, then run an integration test that creates two families and confirms parent A cannot select, insert against, update, or retrieve signed file URLs for parent B’s records. `pnpm test -- rls` → exit 0 with the cross-family denial cases passing.

### Step 3: Build parent onboarding and the durable evidence-capture loop

Implement the first high-frequency user loop. A parent signs in, creates a family, adds one or more students, then lands in **Klio Inbox**: a prominent multimodal **Drop it in** input that accepts text, photos/PDFs, voice clips, grades, books, activities, and CSV files. The parent can optionally select one or more students and an agent intent (for example, understand this, update records, plan from this, or create a lesson).

The capture form must accept:

- photo/PDF upload;
- short written note;
- manual grade and optional subject;
- book/activity entry; and
- CSV file upload for a simple grade export.

On submission, create the `evidence_items` row immediately and preserve the raw source. Enqueue asynchronous extraction rather than waiting for a long model response. The parent sees the capture as received, a processing state, the original source, and the source date. Once ready, present concise agent actions and editable artifacts—not a generic chat transcript.

For the first vertical slice, the agent processes a worksheet image or note and returns a strict JSON object containing: detected subject, candidate skills, summary, uncertainty flags, and a suggested parent question when the evidence is insufficient. Validate the result server-side against a schema, store it as `draft` observations linked to the evidence, and surface it in an approval card. Never mark an observation approved automatically.

Implement rejection/correction controls. A correction produces a new parent-authored observation or a rejection reason; it must not erase the original agent draft or its source link.

**Verify**: `pnpm test -- evidence` → covers text note, image upload metadata, invalid file rejection, agent-schema rejection, approved draft, and corrected/rejected draft. `pnpm test:e2e -- evidence-capture` → a parent can add a student, upload a fixture worksheet, see processing finish, and approve or correct the resulting draft without another family seeing it.

### Step 4: Implement context assembly and the weekly planning agent

Build a deterministic server-side context assembler, not an unbounded chat-history prompt. Given a family and selected student(s), it loads:

- approved learning preferences and current active curriculum/resource records;
- active/most recent approved skill observations;
- recent evidence with dates and source links;
- the current or most recent weekly plan;
- parent-provided available days/time constraints; and
- explicit recent corrections/rejections that the agent must respect.

Create tool contracts for `read_student_context`, `create_draft_skill_observations`, and `create_draft_weekly_plan`. The model may call only these product-owned tools. A plan must have a short rationale, estimated time, linked skills/evidence where relevant, and a manageable number of daily items. The user-facing agent response should say what it used and flag uncertainty; it must not invent completed lessons, grades, or sources.

Build the parent experience around agent actions such as **What should we do next?**, **Plan next week**, **Create a lesson**, and **Summarize our records**. Display every result as a normal editable artifact, not a long chat message. Parents approve, edit, or regenerate it; approval writes an audit event and preserves the prior plan version.

Create prompt fixtures and an evaluation test set with at least: a normal week, a missed/sick week, conflicting evidence, insufficient evidence, two students with different needs, and a parent correction that must change the recommendation. Run the evaluation against a pinned development model configuration and inspect failures before release.

**Verify**: `pnpm test -- planning` → all context assembly and plan-version tests pass. `pnpm test:e2e -- weekly-plan` → parent can produce, edit, approve, and revisit a plan. `pnpm eval:planning` → produces a report with no unsupported-source or cross-student attribution failures.

### Step 5: Add one safe targeted-practice renderer

Do not create an open-ended child chatbot. Build one tested practice component, initially a guided multiple-choice/typed-answer activity suitable for a narrow math or reading skill. The agent supplies a validated `PracticeSpec` only: skill ID, age/level band, question list, choices when applicable, correct answer, hint sequence, and mastery rule. The browser renders the predefined component and scores locally/server-side using the stored answer key.

Create practice only from an approved/developing skill observation or an explicit parent request. After completion, store the result as new evidence and draft a new observation if the mastery rule supports it; parent approval remains required before the skill map changes.

Use a parent-launched, shareable-within-the-family route or a simple child mode secured by a parent session. Do not require child email addresses or direct child accounts in the MVP.

**Verify**: `pnpm test -- practice` → scoring, hint, empty-result, retry, and mastery-threshold cases pass. `pnpm test:e2e -- practice-session` → parent creates a session, student completes it, and the resulting evidence appears as a draft update in the parent view.

### Step 6: Add grade import, auditability, and operational readiness

Implement CSV grade import only. Include a preview/mapping step; show invalid rows and require parent confirmation before creating `grade` evidence records. Preserve the source file in private Storage and link each created record to its import run. Never silently overwrite a previous grade; create a new evidence record and show the difference.

Build these parent-facing views:

- student timeline with evidence, source links, and agent/parent changes;
- current skill map with approved versus draft state visibly distinct;
- weekly plan history; and
- export page for a date-range portfolio containing selected evidence, books/activities, grade records, and an agent-written draft summary clearly labeled for parent review.

Add rate limits to upload, agent, and import endpoints; set file type/size limits; instrument errors without capturing image bodies, raw notes, or child names; and publish a deletion/export workflow. Add a human-readable agent activity page that shows what data each run read, what draft it made, and whether a parent approved it.

**Verify**: `pnpm test -- imports audit export` → import mapping, invalid CSV, no-overwrite, audit-event, and export authorization tests pass. `pnpm test:e2e -- portfolio-export` → a parent imports grades and produces an export limited to their own family/date range. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` → all exit 0.

### Step 7: Pilot privately, measure trust, then choose the next integration

Recruit a small private cohort of homeschool parents only after the prior steps pass. Do not market the product as a compliance or diagnostic tool. Track activation as: family created, student added, first evidence captured, first draft approved/corrected, and first weekly plan approved. Track recommendation trust as approve/edit/reject rates by feature, not merely chat usage.

Conduct weekly qualitative review of agent mistakes and privacy concerns. Use the findings to improve schemas, prompts, evaluations, and the parent correction loop before adding a direct gradebook integration.

At the end of the pilot, investigate HomeschoolHub in this order: official API/OAuth, supported export, then a supervised browser connector. Any browser connector must use a per-parent isolated session/token vault, must never receive a raw password in the model prompt, and must begin read-only. Writing grades or records requires a clear parent confirmation immediately before the external action.

**Verify**: Produce a pilot-readiness checklist showing zero known cross-family access failures, audit logs for every agent mutation, clear deletion/export paths, and an evaluation report for the planning scenarios. Record pilot metrics and decision on the next integration in the new product repository’s `docs/decisions/` folder.

## Test plan

- Use Vitest for schema validation, context assembly, tool contract, import, RLS integration, and practice scoring tests.
- Use Playwright for critical user workflows: parent onboarding, evidence upload/approval, weekly-plan approval, practice completion, and private portfolio export.
- Use prompt/evaluation fixtures for agent behavior. Tests must assert provenance and uncertainty labels, not just that the model returns fluent text.
- Add a two-family isolation suite before every production release. It must check data rows, Storage objects, signed URLs, agent context assembly, and exports.
- Run all verification commands from the table in this plan before each merge/deployment.

## Done criteria

- [ ] This directory is a private Klio Git repository with documented setup and no credentials committed.
- [ ] A parent can sign in, create a family and student, submit a worksheet/photo/note/grade/book/activity, and view the preserved source.
- [ ] The agent creates only schema-validated, source-linked draft observations; a parent can approve, correct, or reject every interpretation.
- [ ] A parent can generate, edit, and approve an evidence-backed weekly plan.
- [ ] One predefined practice component works from a structured specification and returns results as evidence.
- [ ] CSV grade imports are previewed, confirmed, auditable, and non-destructive.
- [ ] No user can access another family’s records, files, signed URLs, agent context, or export in automated tests.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build` all exit 0.
- [ ] The product has a tested export/delete path, audit events for agent actions, and no direct HomeschoolHub/browser login implementation.
- [ ] `plans/README.md` marks this plan DONE only after all prior criteria pass.

## STOP conditions

Stop and report back instead of improvising if:

- The existing Klio directory has a product architecture that materially conflicts with this plan.
- The proposed database/auth provider cannot guarantee per-family data isolation with tested RLS/Storage policies.
- A feature requires directly collecting child credentials, storing a gradebook password, bypassing MFA, or placing authentication material in a model prompt.
- The selected gradebook vendor prohibits the intended integration or has no supported route beyond a brittle browser flow.
- The agent repeatedly produces observations without support from provided evidence, confuses siblings, or cannot meet the evaluation’s provenance assertions.
- The requested product scope expands into legal compliance advice, diagnostic/clinical assessment, or autonomous high-impact external actions.
- Any secret, session token, worksheet image, raw parent note, or child identifier appears in application logs, analytics, test fixtures committed to Git, or model evaluation reports.

## Maintenance notes

- The source-backed evidence and approval model is the core product contract. Do not simplify it into chat history or overwrite old observations when new evidence differs.
- The first browser/gradebook connector should be a separate plan after vendor research. Treat persisted browser storage state as a credential and design token/session revocation before deployment.
- Add semantic/vector retrieval only when the structured context assembler demonstrably misses useful document context; it is not a substitute for relational student records.
- Before adding other student practice types, expand the `PracticeSpec` schema and its deterministic renderer/tests. Never let the model emit executable UI code.
- Reviewers should scrutinize every RLS policy, Storage access path, server/client secret boundary, agent tool schema, source attribution, and approval bypass.
