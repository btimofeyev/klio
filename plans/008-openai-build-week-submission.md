# OpenAI Build Week submission readiness

Deadline: July 21, 2026 at 5:00 PM Pacific.

Feature work is frozen. Only submission blockers, verification fixes, deployment work, judge data, repository packaging, and submission documentation are in scope until the entry is submitted.

## Checklist

- [x] 1. Freeze new feature work.
- [x] 2. Fix the four failing checks and rerun all verification without a competing agent worker.
  - Run Playwright on an isolated Next-only server so it cannot reuse `pnpm dev` and its worker.
  - Bound Vitest concurrency for the local Supabase integration suite.
  - Remove nondeterministic event selection from the proactive boundary test.
  - Required gate: lint, typecheck, Vitest, Playwright, production build, and the standalone Codex containment proof.
  - Verified July 20: lint passed; typecheck passed; Vitest passed 487/487; Playwright passed 16 with 4 intentional opt-in skips; production build passed; standalone containment proof passed 7/7; `git diff --check` passed.
- [x] 3. Deploy the web and worker topology against hosted Supabase.
  - [x] Link the hosted Klio Supabase project and apply all 38 checked-in migrations.
  - [x] Verify local/remote migration parity and run the hosted database lint and security advisors with no error-level findings.
  - [x] Configure hosted Auth URLs for the production app and local development.
  - [x] Deploy the Next web service to Vercel at `https://klio-olive.vercel.app` with hosted Supabase and production secrets.
  - [x] Deploy the bounded `agent:worker` batch as a secured Vercel Cron invocation over the durable Supabase queue.
  - [x] Verify the hosted cron schedule, unauthorized-request rejection, and a successful production worker invocation against hosted Supabase.
- [x] 4. Create one synthetic, preloaded judge account and run a live GPT-5.6 smoke test.
  - [x] Created `test@klio.com` in hosted Supabase Auth and preloaded only synthetic Judge Demo Family data: 3 learners, 18 curriculum units, 296 assignments, 69 evidence items, and 69 reviews.
  - [x] Verified a live web-to-Vercel-worker-to-hosted-Supabase GPT-5.6 job. Turn `570c1f47-fc84-4c2c-82b9-ea8dee208655` completed after filing a no-grade Science evidence draft, identifying the osmosis learning pattern, and generating a focused six-item practice.
  - [x] Exercised the parent handoff, Codex follow-through, parent review approval, generated practice player, and scheduling/undo. Follow-up turn `64115be3-4d97-44eb-883c-f9967f0b5a41` created and scheduled a second grounded six-item practice; proposal `d0fc4c4b-0306-4304-b5bd-5cf6d7256289` was then undone successfully.
  - [x] Stored the judge password outside the repository in the desktop Secret Service keyring under app `klio`, account `test@klio.com`.
  - [x] Saved live browser evidence outside the repository as `klio-gpt56-judge-smoke.mp4` and `klio-parent-review-undo.mp4`.
- [x] 5. Commit the current curriculum work and database migrations.
  - Reviewed the complete diff and verified all 38 local migrations match hosted Supabase.
  - Committed the verified submission scope as `2ab46a1` after item 2 was green.
- [x] 6. Create and push the repository; choose one access model.
  - Published [btimofeyev/klio](https://github.com/btimofeyev/klio) on `main` as a public repository under the MIT License.
- [x] 7. Rewrite the README for submission.
  - Add the product story, judge path, setup, sample-data instructions, deployment topology, and verification commands.
  - Explain Codex collaboration, GPT-5.6 usage, key human decisions, and the bounded safety architecture.
  - Clearly distinguish the July 10 baseline from meaningful work added after the July 13 submission-period start.

## Scope guard

Do not add new product features while this checklist is active. A proposed change must directly close one of the seven items above or fix a regression found by its verification gate.
