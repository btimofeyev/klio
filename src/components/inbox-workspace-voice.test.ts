// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxWorkspace } from "./inbox-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

class MockMediaRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded speech"], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  }
}

describe("InboxWorkspace voice input", () => {
  const stopTrack = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    stopTrack.mockClear();
  });

  it("transcribes a recording into the draft without creating an audio attachment", async () => {
    let resolveTranscription!: (response: Response) => void;
    const transcriptionResponse = new Promise<Response>((resolve) => { resolveTranscription = resolve; });
    const fetchMock = vi.fn().mockReturnValue(transcriptionResponse);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(React.createElement(InboxWorkspace, {
      familyId: "11111111-1111-4111-8111-111111111111",
      students: [{ id: "22222222-2222-4222-8222-222222222222", displayName: "Maya", gradeBand: "5", learningPreferences: null }],
      categories: [],
      initialEvidence: [],
      initialReminders: [],
      initialArtifacts: [],
      pendingApprovals: 0,
      initialAgentTurn: null,
      compact: true,
    }));

    const composer = screen.getByPlaceholderText("Tell Klio what happened or what you need…");
    expect(screen.getByText(/Voice is sent to OpenAI for transcription when recording stops\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
    await user.type(composer, "Today, ");
    await user.click(screen.getByRole("button", { name: "Start voice input" }));
    expect(screen.getByRole("status").textContent).toContain("Recording");
    expect(document.querySelectorAll(".voice-waveform i")).toHaveLength(24);
    expect(screen.queryByRole("button", { name: "Stop voice input" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(screen.getByRole("status").textContent).toContain("Transcribing");

    resolveTranscription(new Response(JSON.stringify({ text: "Maya finished the fractions lesson." }), { status: 200, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe("Today, Maya finished the fractions lesson."));
    expect(screen.getByRole("status").textContent).toContain("Added to your draft. You can edit it before sending.");
    expect(screen.queryByText(/voice-input\.webm/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/transcribe", expect.objectContaining({ method: "POST" }));
    const request = fetchMock.mock.calls[0][1] as { body: FormData };
    expect(request.body.get("file")).toBeInstanceOf(File);
    expect(stopTrack).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Added to your draft. You can edit it before sending.")).toBeNull(), { timeout: 3_500 });
  });
});
