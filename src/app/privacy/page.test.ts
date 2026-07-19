// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "./page";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", { href: String(href), ...props }, children) }));

describe("PrivacyPage", () => {
  afterEach(cleanup);

  it("explains when voice audio leaves Klio and what Klio saves", () => {
    render(React.createElement(PrivacyPage));

    const voiceSection = screen.getByRole("heading", { name: "Voice input" }).nextElementSibling;
    expect(voiceSection?.textContent).toContain("immediately after recording stops");
    expect(voiceSection?.textContent).toContain("before you send the resulting editable draft");
    expect(voiceSection?.textContent).toContain("does not save the recording to your family workspace");
  });
});
