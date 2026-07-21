# Klio

Klio is a bounded homeschool operating workspace for parents coordinating multiple learners. It turns everyday handoffs—notes, worksheets, scores, voice updates, unfinished lessons, and curriculum materials—into evidence-backed plans, reviews, practice, and reversible schedule changes without letting an AI silently become the educational authority.

Built for the **Education** track of [OpenAI Build Week](https://openai.devpost.com/).

- Live app: [klio-olive.vercel.app](https://klio-olive.vercel.app)
- Runtime model: [`gpt-5.6-terra`](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- Stack: Next.js 16, React 19, Supabase, OpenAI Codex SDK, OpenAI Responses API, Vercel Cron
- License: [MIT](./LICENSE)

## The problem

Homeschool planning tools usually track assignments, while general AI assistants produce suggestions. Neither one reliably manages the harder operating problem: a parent is one shared teaching resource across several learners, source work must stay connected to conclusions, grades need review, curriculum order matters, and schedule changes must remain understandable and reversible.

Klio combines those responsibilities in one persistent family workspace. It can do routine follow-through, but every action passes through a narrow domain tool, current family authorization, deterministic policy, and an audit trail.

## What Klio does

- Captures text, photos, PDFs, files, voice notes, explicit scores, books, and activities as preserved evidence.
- Maintains academic terms, learning days, curriculum scope, course order, learner capacity, and parent-attention constraints.
- Uses a persistent conversational agent to file work, organize days, create assignments and reminders, prepare reviews, and generate focused practice.
- Keeps inferred grades, learning interpretations, curriculum-direction changes, and major schedule changes behind parent review.
- Distinguishes provisional written-work feedback from parent-approved learning records.
- Generates structured, answer-safe practice grounded in approved evidence and renders it in a scored learner player.
- Produces weekly briefings, pacing signals, calendar-conflict warnings, and quiet no-op outcomes when nothing needs attention.
- Records undo information for eligible schedule mutations and refuses stale undo operations that would overwrite later work.

## Judge walkthrough

The hosted judge account contains synthetic data only: three learners, four completed weeks, current curriculum and schedule state, evidence history, reviews, attention items, and generated practice.

1. Open [the live app](https://klio-olive.vercel.app) and sign in with `test@klio.com`. The password is supplied in the Devpost testing instructions, never in this repository.
2. On **Home**, inspect the family schedule, weekly briefing, pacing cards, and parent-attention notices.
3. Open **Conversations**, select Jacob, and try:

   > Using Jacob's approved osmosis evidence, create a different six-item Science practice on causal explanations, schedule it for tomorrow, and do not change or invent a grade.

4. Watch the durable receipt move from queued work through evidence reading and practice creation. The Vercel worker runs the turn against hosted Supabase using GPT-5.6 Terra.
5. Open the generated practice to inspect the six-item progression and answer-safe learner view.
6. Open **Attention** to review any draft interpretation. Open the new schedule adjustment to undo it.

The production smoke test exercised the same path: web handoff → durable queue → Codex worker → bounded tools → parent review → generated practice → schedule → successful undo.

## Architecture

```mermaid
flowchart LR
  P[Parent or judge browser] --> W[Next.js web app on Vercel]
  W <--> S[Supabase Auth, Postgres, and Storage]
  W --> Q[Durable agent turn queue]
  Q --> S
  C[Vercel Cron every minute] --> R[Bounded worker batch]
  R <--> S
  R --> X[Codex SDK and GPT-5.6 Terra]
  X <--> M[Klio MCP tool gateway]
  M --> S
```

The web and worker share one codebase but not one request lifecycle. Web requests enqueue durable turns in Supabase. A secured Vercel Cron route claims work fairly across families, renews leases and heartbeats, bounds concurrency and retries, and records progress. The Codex SDK runs with a family-specific workspace and only the Klio MCP tools allowed for that turn.

Structured capture and curriculum-material analysis also use the OpenAI Responses API with Zod-validated outputs. The persistent operating agent uses the Codex SDK with `gpt-5.6-terra` and a signed, expiring capability for the local MCP gateway.

## Bounded authority

Klio's central product decision is that model intelligence and write authority are separate.

- The model receives a current, family-authorized snapshot; stale thread context is supplemental only.
- Capabilities are signed, expiring, turn-bound, requester-bound, family-bound, snapshot-versioned, and limited to named domain tools.
- The agent has no arbitrary SQL, shell, filesystem, browser, generic HTTP, generic record-update, or source-deletion tool.
- Every write revalidates ownership and snapshot state, uses an idempotency key, and records provenance.
- Submitted work and curriculum files are untrusted evidence, never executable instructions.
- Source evidence is preserved. Parent corrections remain available as negative examples rather than being silently overwritten.
- Supabase Row Level Security isolates every family; the browser receives only a publishable key.
- OpenAI, Supabase secret-key, Stripe, and cron credentials stay server-side.

The detailed contract is in [docs/bounded-agent-safety.md](./docs/bounded-agent-safety.md).

## How Codex and GPT-5.6 contributed

### Codex as the build collaborator

Codex accelerated repository exploration, implementation planning, schema and RLS work, Next.js API and UI changes, adversarial test coverage, deployment debugging, and live browser verification. It was especially useful for tracing behaviors across the queue, database policies, runtime tool gateway, receipts, and parent-facing UI instead of treating each layer independently.

The primary Codex `/feedback` Session ID is provided in the Devpost submission form. Dated commits and the submission-readiness plan provide additional evidence of work during the submission period.

### GPT-5.6 in the product

GPT-5.6 Terra interprets parent requests against the authorized family snapshot, chooses among the tools the host permits for that turn, and returns a schema-validated receipt describing what it understood, used, changed, and left for review. It does not receive blanket application authority.

The hosted smoke test used GPT-5.6 Terra to identify a specific osmosis explanation gap without inventing a grade, prepare a parent-reviewable evidence record, generate six grounded practice activities, schedule a follow-up, and then preserve an undo path.

### Key human decisions

| Decision | Why it remained human-owned |
| --- | --- |
| Separate intelligence from authority | A capable model should not imply permission to mutate every family record. |
| Treat the parent as one shared scheduling resource | Student capacity alone cannot prevent overlapping parent-led lessons across siblings. |
| Keep inferred grades and interpretations provisional | Written work and educational judgment require accountable parent review. |
| Prefer deterministic policy for capacity, order, leases, retries, and undo | These invariants must hold even when model output varies. |
| Deploy a real durable worker | The submitted product should behave like the demonstrated product, including background follow-through and recovery. |

## What was built during the submission period

Klio existed before the July 13, 2026 9:00 AM Pacific submission-period start. In accordance with the [official rules](https://openai.devpost.com/rules), only the meaningful extensions added during the submission period are presented as Build Week work.

### Before July 13: baseline

The July 10–11 baseline contained the initial Next.js/Supabase prototype, private family workspaces, multimodal capture, durable jobs, record operations, and an early source-backed parent-review flow. Those capabilities establish the starting point; they are not claimed as new Build Week work.

### July 13–20: meaningful extensions

| Date | Evidence | Meaningful extension |
| --- | --- | --- |
| July 14 | commit `4fd9bb7` | Parent command surface, contextual follow-through, and end-to-end coverage. |
| July 16 | commit `758af2b` | Bounded autonomous homeschool workflows, domain capabilities, review boundaries, and recovery behavior. |
| July 18 | commit `41c3ad7` | Date-scoped workspace flows, pagination, scheduling constraints, and calendar conflicts. |
| July 19–20 | submission commit | Generic curriculum scope and source-backed ingestion, curriculum material enrichment, improved weekly briefings and parent-attention UI, isolated verification fixes, hosted Supabase deployment, Vercel web-plus-worker topology, synthetic judge data, and live GPT-5.6 smoke testing. |

See [plans/008-openai-build-week-submission.md](./plans/008-openai-build-week-submission.md) for the completion record.

## Run locally

### Requirements

- Node.js 20 or newer
- pnpm 10
- Docker
- Supabase CLI
- PostgreSQL client (`psql`) for the optional sample-data seed
- An OpenAI API key for agent execution
- Stripe CLI only when testing billing

### Setup

```bash
git clone https://github.com/btimofeyev/klio.git
cd klio
corepack enable
pnpm install
cp .env.example .env.local
pnpm db:start
pnpm exec supabase status -o env
```

Copy the local Supabase URL, publishable key, and secret key into the matching variables in `.env.local`. Then set:

```dotenv
OPENAI_API_KEY=your_project_key
OPENAI_MODEL=gpt-5.6-terra
KLIO_AGENT_RUNTIME=codex_app_server
KLIO_AGENT_CAPABILITY_SECRET=replace_with_a_long_random_secret
KLIO_AGENT_INLINE=true
NEXT_PUBLIC_APP_URL=http://localhost:3100
```

Generate the capability secret with `openssl rand -hex 32`. Start the web app and local worker together:

```bash
pnpm dev
```

Open [http://localhost:3100](http://localhost:3100). Local Supabase uses ports `56320`–`56329`; Studio is at [http://127.0.0.1:56323](http://127.0.0.1:56323).

## Synthetic sample data

No hosted credentials or real student data are checked into Git. To create the same kind of local synthetic workspace:

1. Start Klio and register `demo@klio.local` through the local signup page.
2. Seed four completed weeks plus the current week:

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' \
  -v ON_ERROR_STOP=1 \
  -v completed_weeks=4 \
  -f scripts/seed-demo-eight-weeks.sql
```

The repeatable fixture creates three synthetic learners, curriculum, assignments, evidence, reviews, pacing state, schedule changes, and practice history.

## Verification

With local Supabase running:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Run the standalone containment tests with:

```bash
node --test proofs/capture-agent-phase0/test/*.test.mjs
```

To opt into the live OpenAI browser test after configuring a valid key:

```bash
RUN_LIVE_OPENAI_E2E=1 pnpm exec playwright test -g "selected evidence becomes"
```

Tests use transient local users and clean up their records. RLS coverage includes family isolation for academic plans, grading, proposals, corrections, instructional records, worker leases, and private Storage.

## Production deployment

The reference deployment uses one Vercel project and hosted Supabase:

1. Create and link a hosted Supabase project.
2. Apply the checked-in migrations with `pnpm exec supabase db push`.
3. Configure the variables from `.env.example` in Vercel. Use production-only random values for `KLIO_AGENT_CAPABILITY_SECRET` and `CRON_SECRET`, set `KLIO_AGENT_INLINE=false`, and point the Supabase and app URLs at the hosted services.
4. Deploy to Vercel. [`vercel.json`](./vercel.json) invokes `/api/internal/agent-worker` every minute; the route requires Vercel's `Authorization: Bearer $CRON_SECRET` header.

The Codex Linux runtime assets are explicitly included in Next.js output tracing for the worker route. Use a Vercel plan whose Node function duration supports the configured long-running agent batch.

## Repository map

```text
src/app/                         Next.js pages and HTTP routes
src/components/                  Parent workspace and learner UI
src/lib/agent/workspace/         Durable turns, snapshots, tools, policy, runtime
src/lib/curriculum/              Scope, research, ingestion, and pacing
src/lib/proactive/               Briefings, reactions, and scheduled evaluation
src/lib/worker/                  Fair bounded worker orchestration
supabase/migrations/             Ordered PostgreSQL schema and RLS migrations
e2e/                             Playwright product and safety flows
proofs/capture-agent-phase0/     Standalone Codex containment proof
```

## License

Copyright © 2026 Ben Timofeyev. Released under the [MIT License](./LICENSE).
