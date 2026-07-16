import { describe, expect, it } from "vitest";
import { postgresUuidSchema } from "./postgres-uuid";

describe("postgresUuidSchema", () => {
  it("accepts database-owned deterministic ids without RFC variant bits", () => {
    expect(postgresUuidSchema.safeParse("2303e90b-e292-4bf0-3529-f0d5c10cc3a7").success).toBe(true);
  });

  it.each(["", "not-an-id", "2303e90b-e292-4bf0-3529-f0d5c10cc3a7-extra"])("rejects malformed ids: %s", (value) => {
    expect(postgresUuidSchema.safeParse(value).success).toBe(false);
  });
});
