// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConversationDTO, AgentTurnDTO } from "@/lib/data/workspace";
import { InboxWorkspace } from "./inbox-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
    return { channel: vi.fn(() => channel), removeChannel: vi.fn() };
  },
}));

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

const familyId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const turnId = "33333333-3333-4333-8333-333333333333";
const now = "2026-07-18T14:00:00.000Z";

const turn: AgentTurnDTO = {
  id: turnId,
  status: "completed",
  goal: "summary",
  request: "Review the family’s recent approved learning records.",
  result: {
    schemaVersion: 1,
    kind: "completed",
    message: "The recent learning records are organized and ready to review.",
    understood: [],
    used: [],
    changed: [],
    remaining: [],
    actions: [],
  },
  clarification: null,
  events: [],
  tools: [],
  taskName: "Reviewing recent learning",
  studentId: null,
  subject: null,
  sourceCount: 0,
  normalizedStep: "finished",
  expectedOutput: null,
  createdAt: now,
  startedAt: now,
  lastHeartbeatAt: now,
  lastProgressAt: now,
  conversationId,
  interactionMode: "answer",
  streamedMessage: null,
};

const conversation: AgentConversationDTO = {
  id: conversationId,
  title: "Review the family’s recent approved learning records",
  studentId: null,
  messages: [
    { id: "44444444-4444-4444-8444-444444444444", role: "user", content: turn.request, turnId, createdAt: now },
    { id: "55555555-5555-4555-8555-555555555555", role: "assistant", content: turn.result!.message, turnId, createdAt: now },
  ],
};

describe("InboxWorkspace recent conversations", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reopens the current conversation after it was minimized", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`conversationId=${encodeURIComponent(conversationId)}`)) {
        return new Response(JSON.stringify({ turns: [turn], conversation }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        conversations: [{ id: conversationId, title: conversation.title, studentId: null, updatedAt: now }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(React.createElement(InboxWorkspace, {
      familyId,
      students: [],
      categories: [],
      initialEvidence: [],
      initialReminders: [],
      initialArtifacts: [],
      pendingApprovals: 0,
      initialAgentTurn: turn,
      initialAgentConversation: conversation,
      compact: true,
    }));

    expect(await screen.findByRole("dialog", { name: "Conversation with Klio" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close conversation" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conversation with Klio" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const currentThread = await screen.findByRole("button", { name: /Review the family’s recent approved learning records/ });
    expect(currentThread.querySelector('[aria-label="Current conversation"]')).toBeTruthy();
    await user.click(currentThread);

    expect(await screen.findByRole("dialog", { name: "Conversation with Klio" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agent/turns?familyId=${encodeURIComponent(familyId)}&conversationId=${encodeURIComponent(conversationId)}`,
      { cache: "no-store" },
    );
  });

  it("ignores a stale refresh after switching conversations", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const nextConversationId = "66666666-6666-4666-8666-666666666666";
    const nextTurnId = "77777777-7777-4777-8777-777777777777";
    const nextTurn: AgentTurnDTO = {
      ...turn,
      id: nextTurnId,
      request: "Show me the new conversation.",
      result: { ...turn.result!, message: "This is the new conversation response." },
      conversationId: nextConversationId,
    };
    const nextConversation: AgentConversationDTO = {
      id: nextConversationId,
      title: "The new conversation",
      studentId: null,
      messages: [
        { id: "88888888-8888-4888-8888-888888888888", role: "user", content: nextTurn.request, turnId: nextTurnId, createdAt: now },
        { id: "99999999-9999-4999-8999-999999999999", role: "assistant", content: nextTurn.result!.message, turnId: nextTurnId, createdAt: now },
      ],
    };
    let resolveStaleRefresh!: (response: Response) => void;
    const staleRefresh = new Promise<Response>((resolve) => { resolveStaleRefresh = resolve; });
    let oldConversationRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`conversationId=${encodeURIComponent(conversationId)}`)) {
        oldConversationRequests += 1;
        if (oldConversationRequests === 1) return staleRefresh;
        return new Response(JSON.stringify({ turns: [turn], conversation }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes(`conversationId=${encodeURIComponent(nextConversationId)}`)) {
        return new Response(JSON.stringify({ turns: [nextTurn], conversation: nextConversation }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        turns: [nextTurn, turn],
        conversations: [
          { id: nextConversationId, title: nextConversation.title, studentId: null, updatedAt: now },
          { id: conversationId, title: conversation.title, studentId: null, updatedAt: now },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(React.createElement(InboxWorkspace, {
      familyId,
      students: [],
      categories: [],
      initialEvidence: [],
      initialReminders: [],
      initialArtifacts: [],
      pendingApprovals: 0,
      initialAgentTurn: turn,
      initialAgentConversation: conversation,
      compact: true,
    }));

    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(await screen.findByRole("button", { name: /Review the family’s recent approved learning records/ }));
    await waitFor(() => expect(oldConversationRequests).toBe(1));
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(await screen.findByRole("button", { name: /The new conversation/ }));
    expect(await screen.findByText("This is the new conversation response.")).toBeTruthy();

    resolveStaleRefresh(new Response(JSON.stringify({ turns: [turn], conversation }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await waitFor(() => expect(screen.getByText("This is the new conversation response.")).toBeTruthy());
    expect(screen.queryByText("The recent learning records are organized and ready to review.")).toBeNull();
  });
});
