import { describe, expect, it } from "vitest";
import { createClientUuid } from "./uuid";

describe("createClientUuid", () => {
  it("creates RFC 4122 version 4 identifiers without randomUUID", () => {
    expect(createClientUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not repeat identifiers", () => {
    expect(createClientUuid()).not.toBe(createClientUuid());
  });
});
