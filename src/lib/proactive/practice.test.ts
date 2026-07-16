import { describe, expect, it } from "vitest";
import { buildTargetedPractice } from "./practice";

const base = { subject: "Biology", skillKey: "osmosis-explanations", levelBand: "6-8", assignmentDirections: null, reviewFeedback: [], evidenceExcerpts: [], priorPracticeNotes: [], parentCorrections: [], curriculumPosition: null };

describe("evidence-grounded proactive practice", () => {
  it("returns needs-detail input as null instead of unrelated generic practice", () => {
    expect(buildTargetedPractice({ ...base, subject: "World History", skillKey: "industrial-revolution", reviewFeedback: ["Needs more detail."] })).toBeNull();
    expect(buildTargetedPractice({ ...base, subject: "Algebra I", skillKey: "linear-equations", reviewFeedback: ["Several answers were incorrect."] })).toBeNull();
  });

  it("uses the actual science misconception and includes multiple fitting activity types", () => {
    const practice = buildTargetedPractice({ ...base, assignmentDirections: "Explain osmosis using concentration and water movement.", reviewFeedback: ["The response reversed the direction of water movement."] });
    expect(practice?.activities.map((activity) => activity.type)).toEqual(expect.arrayContaining(["multiple_choice", "short_answer", "written_response"]));
    expect(practice?.instructions).toContain("concentration");
  });

  it("uses an equation only when that equation exists in the source context", () => {
    const practice = buildTargetedPractice({ ...base, subject: "Algebra I", skillKey: "linear-equations", evidenceExcerpts: ["The learner solved 3x + 5 = 20 as x = 8."] });
    expect(practice?.activities[0]).toMatchObject({ type: "short_answer", accepted_answers: expect.arrayContaining(["5"]) });
    expect(JSON.stringify(practice)).not.toContain("4(x - 2)");
  });
});
