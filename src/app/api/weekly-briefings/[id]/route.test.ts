import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireParent: vi.fn(),
  createClient: vi.fn(),
  enqueueTurn: vi.fn(),
  processTurn: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/require-parent", () => ({ requireParentApi: mocks.requireParent }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/agent/workspace/turns", () => ({ enqueueWorkspaceTurn: mocks.enqueueTurn }));
vi.mock("@/lib/agent/workspace/runtime", () => ({ processWorkspaceTurn: mocks.processTurn }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/env", () => ({ serverEnv: { klioAgentRuntime: "codex_app_server", klioAgentInline: false } }));

import { PATCH } from "./route";

const parentId = "11111111-1111-4111-8111-111111111111";
const familyId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";
const briefingId = "44444444-4444-4444-8444-444444444444";
const activeBriefing = { id: briefingId, family_id: familyId, status: "active", week_start: "2026-07-20", viewed_at: null };

describe("PATCH /api/weekly-briefings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireParent.mockResolvedValue({ id: parentId });
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mocks.createClient.mockResolvedValue(supabaseClient({ briefing: activeBriefing, student: { id: studentId } }));
    mocks.enqueueTurn.mockResolvedValue({ turn: { id: "turn-1", status: "queued" }, duplicate: false });
  });

  it("queues a conversationless action turn for the briefing", async () => {
    const response = await PATCH(handleRequest(), context());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ turn: { id: "turn-1", status: "queued" }, duplicate: false });
    expect(mocks.enqueueTurn).toHaveBeenCalledWith(expect.objectContaining({
      familyId,
      requestedBy: parentId,
      studentId,
      goal: "weekly_plan",
      interactionMode: "act",
      taskName: "Handling weekly briefing",
      contextDate: "2026-07-20",
      authorizations: ["schedule_moves"],
    }));
    expect(mocks.enqueueTurn.mock.calls[0][0]).not.toHaveProperty("conversationId");
    expect(mocks.processTurn).not.toHaveBeenCalled();
  });

  it("does not queue work for a learner outside the briefing family", async () => {
    mocks.createClient.mockResolvedValue(supabaseClient({ briefing: activeBriefing, student: null }));

    const response = await PATCH(handleRequest(), context());

    expect(response.status).toBe(404);
    expect(mocks.enqueueTurn).not.toHaveBeenCalled();
  });

  it("requires a signed-in parent before reading the briefing", async () => {
    mocks.requireParent.mockRejectedValue(new Error("UNAUTHORIZED"));

    const response = await PATCH(handleRequest(), context());

    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

function handleRequest() {
  return new Request(`http://localhost/api/weekly-briefings/${briefingId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "handle", request: "Handle the current briefing in the background.", studentId }),
  });
}

function context() {
  return { params: Promise.resolve({ id: briefingId }) };
}

function supabaseClient(input: { briefing: typeof activeBriefing | null; student: { id: string } | null }) {
  return {
    from(table: string) {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: table === "weekly_briefings" ? input.briefing : input.student, error: null })),
      };
      return builder;
    },
  };
}
