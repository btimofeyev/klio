# Klio

Klio is a bounded homeschool operating workspace. It keeps a parent organized and on track while acting as a teacher assistant, grader, planner, and operations assistant. A parent can capture a note, worksheet photo, PDF, voice note, explicit score, book, or activity; Klio preserves the source and uses a current, family-authorized context to prepare or carry out ordinary work.

Klio is not allowed to improvise authority. Low-risk actions follow the family’s autonomy policy and remain visible; undoable schedule changes keep an undo record. Inferred grades, curriculum-direction changes, and major schedule changes stay behind a parent review boundary by default.

## What works

- Email/password signup, private family onboarding, and multiple learners
- A responsive multimodal inbox with text, drag-and-drop files, photos, PDFs, CSVs, and browser-recorded voice notes
- Private Supabase Storage with short-lived authorized download links
- OpenAI Responses API analysis using structured outputs, image/PDF input, and voice transcription
- Evidence-backed draft artifacts: analysis, next step, weekly plan, lesson, summary, portfolio, and practice
- Parent approval/rejection, source-linked skill observations, and append-only audit history
- Parent-defined academic terms, learning days, learner goals, subject cadence, curriculum pacing targets, and deterministic on-track checkpoints
- Current, overdue, upcoming, recently completed, pending-review, correction, goal, pacing, and capacity context even when a family has a long assignment history
- Bounded assignment, scheduling, completion, explicit-score, review, lesson, goal, curriculum-proposal, and supplemental-practice operations
- Provisional versus finalized grading for objective, written, and mixed work; written work cannot create automatic mastery conclusions before review
- Evidence-grounded practice built from approved reviews, directions, actual misconceptions, curriculum position, and parent corrections
- Morning preparation, evening reconciliation, weekly pacing review, assignment/submission/grade/practice reactions, quiet no-op outcomes, and deduplicated insights
- Inline clarification that pauses a persistent task, accepts one parent answer, resumes with a fresh authorized snapshot, and prevents duplicate mutations
- Structured receipts showing what Klio understood, used, changed, left as a draft, needs approved, or made undoable
- Fair bounded worker concurrency across families with one mutating operation per family, leases, heartbeats, bounded retries, and stalled-work recovery
- Weekly plan items with completion tracking
- Safe predefined practice renderer with server-side scoring and results returned as evidence
- CSV grade preview, column mapping, confirmation, and non-destructive evidence creation
- Date-range portfolio export
- Stripe Checkout, Customer Portal, signed webhooks, and local Stripe CLI forwarding
- Two-family RLS and Storage isolation tests

The repository intentionally contains no seeded users or product data.

## Requirements

- Node.js 20 or newer
- pnpm
- Docker
- Supabase CLI
- Stripe CLI for billing work
- An OpenAI API key for agent execution

## Run locally

```bash
pnpm install
supabase start
pnpm dev
```

Open [http://localhost:3100](http://localhost:3100). Local Supabase uses ports `56320`–`56329` so it can coexist with other local projects. Studio is available at [http://127.0.0.1:56323](http://127.0.0.1:56323).

The checked-in `.env.example` lists every supported variable. `supabase start -o env` prints the local publishable and secret keys. Put local values in `.env.local`, which is ignored by Git.

To enable the agent, set:

```dotenv
OPENAI_API_KEY=your_project_key
OPENAI_MODEL=gpt-5.6-terra
```

Restart `pnpm dev` after changing environment variables.

To run the live API browser check after configuring a valid key:

```bash
RUN_LIVE_OPENAI_E2E=1 pnpm exec playwright test -g "selected evidence becomes"
```

## Stripe locally

Add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and the public key to `.env.local`, then forward signed webhook events:

```bash
pnpm stripe:listen
```

Copy the CLI-provided signing secret into `STRIPE_WEBHOOK_SECRET` and restart the app. Billing remains unavailable with a clear configuration error until these values are present.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Tests create only transient local users and records and delete them afterward. The RLS suite covers family isolation for the academic plan, grading, proposals, corrections, instructional records, worker leases, and private Storage in addition to the original family records.

Useful database commands:

```bash
pnpm db:reset
pnpm db:types
```

## Security boundaries

- The browser receives only the Supabase publishable key.
- Supabase secret access and all OpenAI/Stripe calls are server-only.
- Every product table has RLS enabled; family membership is stored in the database rather than editable user metadata.
- Evidence files live in a private bucket under a family UUID prefix.
- Raw student notes, documents, and names are not logged or sent to analytics.
- OpenAI requests use `store: false`, schema-validated outputs, privacy-preserving safety identifiers, and only the evidence selected by the parent plus bounded learner context.
- Agent capabilities are signed, expiring, turn-bound, family-bound, requester-bound, snapshot-versioned, and limited to domain-specific tools. Klio has no arbitrary SQL, shell, filesystem, HTTP, browser, generic record-update, or source-deletion tool.
- Every write revalidates family ownership and current snapshot state, uses an idempotency key, and records audit provenance. Stale proposals fail instead of overwriting newer parent changes.
- Submitted work, notes, PDFs, and captured links are untrusted evidence, never executable instructions. Model content is rendered only through validated structured contracts.
- Captured curriculum links are references for the parent. Klio validates HTTP(S) references but does not fetch or inspect linked pages; no unrestricted browsing or generic URL fetch is enabled.
- Credits, hours, standards, and instructional-day records are parent-configurable planning facts only. Klio does not claim legal compliance or prescribe state requirements.
- Source evidence is preserved. The agent cannot delete or silently overwrite it, and parent corrections are retained as negative examples for later recommendations.
- The local Supabase credentials are development-only defaults and must never be used for a hosted deployment.

See [the bounded operating-agent plan](plans/005-bounded-homeschool-operating-agent.md) and [the safety architecture](docs/bounded-agent-safety.md) for the current product contract and security boundaries.
