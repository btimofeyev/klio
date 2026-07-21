import { describe, expect, it } from "vitest";
import { streamedTerminalMessage } from "./streamed-terminal-message";

describe("streamedTerminalMessage", () => {
  it("extracts a completed parent-facing message without exposing the envelope", () => {
    expect(streamedTerminalMessage('{"kind":"completed","message":"Hello! How can I help?","used":[]}')).toBe("Hello! How can I help?");
  });

  it("extracts an incomplete message as it streams", () => {
    expect(streamedTerminalMessage('{"kind":"completed","message":"I can help organize')).toBe("I can help organize");
  });

  it("decodes escaped markdown and punctuation", () => {
    expect(streamedTerminalMessage('{"message":"First line\\n\\n**Next:** ask me \\"why?\\""}')).toBe('First line\n\n**Next:** ask me "why?"');
  });

  it("keeps the last safe value while an escape sequence is incomplete", () => {
    expect(streamedTerminalMessage('{"message":"Temperature: \\u00', "Temperature:")).toBe("Temperature:");
    expect(streamedTerminalMessage('{"message":"Path\\', "Path")).toBe("Path");
  });

  it("keeps the current message before the message field arrives", () => {
    expect(streamedTerminalMessage('{"kind":"completed"', "Still working")).toBe("Still working");
  });
});
