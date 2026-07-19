// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantRichMessage } from "./assistant-rich-message";

describe("AssistantRichMessage", () => {
  afterEach(cleanup);

  it("renders useful Markdown structure instead of flattening the answer", () => {
    render(React.createElement(AssistantRichMessage, { content: [
      "## What the records show",
      "",
      "- Biology explanations need support.",
      "- Algebra is improving.",
      "",
      "| Subject | Result |",
      "| --- | ---: |",
      "| Biology | 69% |",
      "| Algebra | 86% |",
    ].join("\n") }));

    expect(screen.getByRole("heading", { name: "What the records show" })).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Biology")).toBeTruthy();
    expect(within(table).getByText("69%")).toBeTruthy();
  });

  it("renders a bounded accessible trend chart from strict chart data", () => {
    const chart = JSON.stringify({
      title: "Biology results",
      unit: "%",
      series: [{ name: "Jacob", values: [{ label: "A1", value: 86 }, { label: "A2", value: 78 }, { label: "A3", value: 69 }] }],
    });
    render(React.createElement(AssistantRichMessage, { content: `\`\`\`chart\n${chart}\n\`\`\`` }));

    expect(screen.getByRole("figure", { name: "Biology results" })).toBeTruthy();
    const accessibleData = screen.getByRole("table", { name: "Biology results" });
    expect(within(accessibleData).getByText("86%")).toBeTruthy();
    expect(within(accessibleData).getByText("69%")).toBeTruthy();
  });

  it("does not make an unsafe Markdown destination clickable", () => {
    render(React.createElement(AssistantRichMessage, { content: "[unsafe](javascript:alert(1))" }));
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
    expect(screen.getByText("unsafe")).toBeTruthy();
  });
});
