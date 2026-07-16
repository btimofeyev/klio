import { describe, expect, it } from "vitest";
import { buildHostPublicResult, normalizePublicResult, publicResultSchema } from "./public-result";

const id = "00000000-0000-4000-8000-000000000001";

describe("workspace public results", () => {
  it("constructs internal actions from validated tool results, not model URLs", () => {
    const result = buildHostPublicResult({
      terminal: { kind: "completed", message: "Done", understood: [], used: [], changed: [], remaining: [] },
      toolResults: [{ outcome: "draft_ready", artifactId: id, href: "https://unsafe.example" }],
      waitingForClarification: false,
    });
    expect(result.kind).toBe("draft_ready");
    expect(result.actions).toEqual([{ verb: "open", label: "Open created work", targetType: "artifact", targetId: id, href: `/app/activity?artifact=${id}` }]);
  });

  it("renders legacy prose safely and ignores arbitrary action fields", () => {
    expect(normalizePublicResult({ message: "Legacy receipt", actions: [{ href: "javascript:alert(1)" }] })).toEqual({
      schemaVersion: 1, kind: "completed", message: "Legacy receipt", understood: [], used: [], changed: [], remaining: [], actions: [],
    });
  });

  it("rejects non-internal destinations", () => {
    const value = normalizePublicResult({ schemaVersion: 1, kind: "completed", message: "Done", understood: [], used: [], changed: [], remaining: [], actions: [{ verb: "open", label: "Bad", targetType: "artifact", targetId: id, href: "https://example.com" }] });
    expect(value.actions).toEqual([]);
    expect(publicResultSchema.safeParse(value).success).toBe(true);
  });

  it("routes domain planning proposals to the host review surface", () => {
    const result = buildHostPublicResult({
      terminal: { kind: "proposal", message: "A goal change is ready.", understood: [], used: [], changed: [], remaining: ["Parent approval"] },
      toolResults: [{ outcome: "review_required", proposalId: id, proposalKind: "learner_goal" }],
      waitingForClarification: false,
    });
    expect(result.actions).toEqual([{ verb: "open", label: "Review proposal", targetType: "planning_proposal", targetId: id, href: `/app/adjustments?planning=${id}` }]);
  });

  it("turns an applied schedule result into a direct undo action", () => {
    const result = buildHostPublicResult({
      terminal: { kind: "completed", message: "The day is organized.", understood: [], used: [], changed: [], remaining: [] },
      toolResults: [{ outcome: "completed", proposalId: id, undoAvailable: true }],
      waitingForClarification: false,
    });
    expect(result.kind).toBe("undoable");
    expect(result.actions).toEqual([{ verb: "undo", label: "Undo change", targetType: "adjustment", targetId: id, href: `/app/adjustments?proposal=${id}` }]);
  });

  it("keeps actions for database-owned deterministic ids", () => {
    const assignmentId = "3291da37-a0c3-f574-8703-9493c14bc96e";
    const result = buildHostPublicResult({
      terminal: { kind: "completed", message: "Done", understood: [], used: [], changed: [], remaining: [] },
      toolResults: [{ outcome: "completed", assignmentId }],
      waitingForClarification: false,
    });
    expect(result.actions[0]).toMatchObject({ targetId: assignmentId, href: `/app/activity?record=${assignmentId}` });
  });

  it("never exposes internal tool names in the parent receipt", () => {
    const result = buildHostPublicResult({
      terminal: { kind: "clarification", message: "One detail is needed.", understood: [], used: ["ask_parent"], changed: [], remaining: [] },
      toolResults: [],
      waitingForClarification: true,
    });
    expect(result.used).toEqual(["Prepared one question"]);
    expect(JSON.stringify(result)).not.toContain("ask_parent");
    expect(normalizePublicResult({ ...result, used: ["ask_parent"] }).used).toEqual(["Prepared one question"]);
  });

  it("opens generated practice in the Today workspace and removes internal ids from receipt copy", () => {
    const result = buildHostPublicResult({
      terminal: { kind: "draft_ready", message: "Practice is ready.", understood: [], used: [], changed: [`Created practice draft ${id} for approval`], remaining: [] },
      toolResults: [{ outcome: "draft", artifactId: id, artifactType: "practice" }],
      waitingForClarification: false,
    });
    expect(result.actions).toEqual([{ verb: "open", label: "Open practice", targetType: "artifact", targetId: id, href: `/app?artifact=${id}` }]);
    expect(result.changed).toEqual(["Created practice draft for approval"]);
    expect(JSON.stringify(result)).not.toContain(`draft ${id}`);
  });
});
