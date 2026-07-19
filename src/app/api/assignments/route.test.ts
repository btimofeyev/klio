import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCurriculumAssignmentCursor } from "@/lib/data/operation-assignment-pages";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireParent: vi.fn(),
  createClient: vi.fn(),
  loadPage: vi.fn(),
}));

vi.mock("@/lib/auth/require-parent", () => ({ requireParentApi: mocks.requireParent }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/data/operations", () => ({ loadCurriculumAssignmentPage: mocks.loadPage }));

import { GET } from "./route";

const familyId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";
const cursor = encodeCurriculumAssignmentCursor({ v: 1, sequence: 50, id: "44444444-4444-4444-8444-444444444444" });
const unit = {
  id: unitId,
  student_id: studentId,
  subject: "Math",
  title: "Algebra",
  sequence_label: "Lesson",
  next_sequence_number: 126,
  default_minutes: 40,
  status: "active",
  schedule_rule: {},
  curriculum_url: null,
  attention_mode: "independent",
  parent_attention_minutes: null,
};

describe("GET /api/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireParent.mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555" });
    mocks.createClient.mockResolvedValue(supabaseClient({ membership: { family_id: familyId }, unit }));
    mocks.loadPage.mockResolvedValue({ assignments: [{ id: "assignment-1" }], nextCursor: cursor });
  });

  it("requires authentication", async () => {
    mocks.requireParent.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid or unknown query parameters", async () => {
    const invalid = await GET(new Request(`http://localhost/api/assignments?familyId=nope&curriculumUnitId=${unitId}`));
    expect(invalid.status).toBe(400);
    const unknown = await GET(new Request(`${request().url}&offset=50`));
    expect(unknown.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns 403 when the parent does not belong to the family", async () => {
    mocks.createClient.mockResolvedValue(supabaseClient({ membership: null, unit }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.loadPage).not.toHaveBeenCalled();
  });

  it("returns 404 when the unit is missing from the requested family", async () => {
    mocks.createClient.mockResolvedValue(supabaseClient({ membership: { family_id: familyId }, unit: null }));
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(mocks.loadPage).not.toHaveBeenCalled();
  });

  it("returns the first page with its continuation cursor", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ assignments: [{ id: "assignment-1" }], nextCursor: cursor });
    expect(mocks.loadPage).toHaveBeenCalledWith(expect.objectContaining({ familyId, unit, limit: 50, cursor: undefined }));
  });

  it("passes a valid cursor to the next page and returns a null cursor at the end", async () => {
    mocks.loadPage.mockResolvedValue({ assignments: [{ id: "assignment-2" }], nextCursor: null });
    const response = await GET(request({ cursor, limit: "100" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ assignments: [{ id: "assignment-2" }], nextCursor: null });
    expect(mocks.loadPage).toHaveBeenCalledWith(expect.objectContaining({ cursor, limit: 100 }));
  });

  it("rejects a malformed cursor before database access", async () => {
    const response = await GET(request({ cursor: "not-a-cursor" }));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.loadPage).not.toHaveBeenCalled();
  });
});

function request(extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ familyId, curriculumUnitId: unitId, ...extra });
  return new Request(`http://localhost/api/assignments?${params.toString()}`);
}

function supabaseClient(input: { membership: unknown; unit: unknown }) {
  return {
    from(table: string) {
      const result = table === "family_members" ? input.membership : input.unit;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        neq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: result, error: null })),
      };
      return builder;
    },
  };
}
