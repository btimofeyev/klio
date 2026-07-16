# Bounded operating-agent safety

Klio can interpret family learning records and complete ordinary homeschool operations, but the model is not the authorization layer. The server owns family scope, capability issuance, policy decisions, staleness checks, idempotency, audit provenance, approval, and undo.

## Authority and context

- Every turn starts from a bounded, deterministic family snapshot. Current, overdue, upcoming, recently completed, pending-review, pacing, correction, reminder, proposal, and recent-action records outrank old history.
- The standard snapshot has deterministic record and serialization bounds. Purpose-specific read tools provide paginated or narrowly filtered history without disclosing another family.
- A tool capability is signed and includes the turn, family, requester, allowed tools, snapshot version, nonce, issued time, and expiration. The gateway also requires the turn to still be running.
- A model cannot acquire arbitrary SQL, table mutation, shell, filesystem, HTTP, browser, arbitrary URL, client-command, or source-deletion authority.

## Mutation boundary

- Tool inputs use strict Zod contracts with string, collection, and numeric limits.
- The gateway rechecks the affected learner and entity against the authorized family. Direct writes fail on a changed family context version; reviewable proposals store their snapshot version and expire when newer parent changes make them stale.
- Writes use family-scoped idempotency keys. Meaningful operations emit audit records with redacted tool-call metadata and source provenance.
- Automatic scheduling is restricted to bounded ordinary work, respects capacity and family policy, remains visible, and uses the same reversible adjustment path as parent-approved proposals.
- Source evidence is append-only from the agent’s perspective. Parent corrections add durable negative examples instead of rewriting the source.

## Parent control

- Autonomy levels are enforced server-side: `automatic`, `automatic_with_undo`, `confirm`, `ask`, and `never` each map to a real handler or interaction path.
- Inferred grades, major schedule changes, and curriculum-direction changes require a parent interaction by default. Source deletion is unavailable to the agent.
- A clarification is a durable state transition: waiting, answered/resumed, completed, failed, or cancelled. A response resumes the persistent thread with a fresh snapshot and cannot be applied twice.
- Terminal results use validated action cards. The host maps known target types to internal destinations; model text cannot supply an arbitrary URL or executable client action.

## Grading, mastery, and practice

- Objective, written, and mixed work record provisional/final state explicitly. Written responses that still need review cannot create a final score, mastery conclusion, support removal, or long-term trend.
- Only approved, finalized, comparable evidence enters trend and pace calculations. Curriculum evidence remains distinguishable from supplemental practice.
- Explicit parent scores are preserved as explicit facts. Rejected grading drafts are not learner facts; parent-edited and rejected drafts become correction examples.
- Supplemental practice requires enough assignment directions, review feedback, evidence, learner level, subject/skill, prior practice, correction, and curriculum-position context to make an accurate structured activity. Otherwise Klio records a needs-detail result.

## Untrusted content and links

- Learner work, captures, PDFs, imported records, notes, and links are evidence, not instructions for the agent runtime.
- Generated content is data rendered by predefined components; it is never executable HTML, JavaScript, SQL, React, or a generic client command.
- Curriculum URLs are reference-only. The product accepts credential-free HTTP(S) references and clearly says Klio does not open or read the page. This avoids exposing a generic fetch surface or incomplete SSRF defense.

## Isolation and reliability

- Family-scoped tables use RLS and compound family/entity ownership constraints where records cross-reference each other. Service-role operations remain server-only.
- Multiple families may run concurrently, while a renewable database lease serializes mutating work for one family. Heartbeats, bounded attempts, idempotent handlers, and expired-lease recovery make retries safe.
- Proactive evaluation can persist a calm no-op. It deduplicates insights and avoids recursively enqueuing the agent’s own writes.

Klio’s term, credit, hour, standard, and instructional-day records are parent-owned planning data. They are not a state-law compliance engine or legal advice.
