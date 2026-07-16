import { describe, expect, it } from "vitest";
import { referenceUrlSchema, safeReferenceUrl } from "./reference-url";

describe("stored reference URLs", () => {
  it("accepts bounded http and https references without fetching them", () => {
    expect(referenceUrlSchema.parse("https://curriculum.example/unit/1")).toBe("https://curriculum.example/unit/1");
    expect(safeReferenceUrl("http://example.test/lesson")).toBe("http://example.test/lesson");
  });

  it("rejects executable schemes, malformed input, and embedded credentials", () => {
    expect(referenceUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(referenceUrlSchema.safeParse("https://user:password@example.test/private").success).toBe(false);
    expect(referenceUrlSchema.safeParse("not a URL").success).toBe(false);
    expect(safeReferenceUrl("data:text/html,hello")).toBeNull();
  });
});
