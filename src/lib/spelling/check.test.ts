import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkSpelling } from "./check";

describe("checkSpelling", () => {
  it("suggests corrections without flagging Klio vocabulary", () => {
    const issues = checkSpelling(["thrty", "mintues", "minutes", "Klio", "homeschool"]);

    expect(issues.find((issue) => issue.word === "thrty")?.suggestions).toContain("thirty");
    expect(issues.find((issue) => issue.word === "mintues")?.suggestions).toContain("minutes");
    expect(issues.map((issue) => issue.word)).not.toContain("minutes");
    expect(issues.map((issue) => issue.word)).not.toContain("Klio");
    expect(issues.map((issue) => issue.word)).not.toContain("homeschool");
  });
});
