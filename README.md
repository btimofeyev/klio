# Klio

Klio is a capture-first homeschool agent workspace. A parent can drop in a note, worksheet photo, PDF, voice note, grade CSV, book, or activity; Klio preserves the original evidence and uses selected family context to create reviewable plans, lessons, summaries, skill observations, and structured practice.

Agent output is always a draft. A parent must approve record changes and artifacts.

## What works in the prototype

- Email/password signup, private family onboarding, and multiple learners
- A responsive multimodal inbox with text, drag-and-drop files, photos, PDFs, CSVs, and browser-recorded voice notes
- Private Supabase Storage with short-lived authorized download links
- OpenAI Responses API analysis using structured outputs, image/PDF input, and voice transcription
- Evidence-backed draft artifacts: analysis, next step, weekly plan, lesson, summary, portfolio, and practice
- Parent approval/rejection, source-linked skill observations, and append-only audit history
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

Tests create only transient local users and records and delete them afterward. The RLS suite verifies that one authenticated family cannot read another family, insert a learner into it, or upload into its private Storage prefix.

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
- The local Supabase credentials are development-only defaults and must never be used for a hosted deployment.

See [the MVP plan](plans/001-homeschool-agent-mvp.md) for the product contract and release boundaries.
