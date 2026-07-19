import { describe, expect, it } from "vitest";
import {
  assistantStarterCatalog,
  assistantStarterGroupOrder,
  assistantStarterGroups,
  assistantStarterIds,
  rankAssistantStarterIds,
  resolveAssistantStarter,
  supportedAssistantIntents,
} from "./assistant-starters";

const learnerContext = { learnerName: "Maya", workspaceDate: "2026-07-16" };
const assignmentContext = { ...learnerContext, assignmentTitle: "Lesson 23", subject: "Pre-Algebra" };

describe("assistant starter catalog", () => {
  it("keeps stable group and starter order", () => {
    expect(assistantStarterGroups.map((group) => group.id)).toEqual(assistantStarterGroupOrder);
    expect(assistantStarterCatalog.map((starter) => starter.id)).toEqual(assistantStarterIds);
  });

  it("ranks the family-mode top three", () => {
    expect(rankAssistantStarterIds({})).toEqual(["family_briefing", "plan_week", "review_recent_learning"]);
  });

  it("ranks the learner-mode top three", () => {
    expect(rankAssistantStarterIds(learnerContext)).toEqual(["organize_today", "teach_next_lesson", "review_recent_learning"]);
  });

  it("ranks the assignment-context top three", () => {
    expect(rankAssistantStarterIds(assignmentContext)).toEqual(["teach_next_lesson", "practice_from_mistakes", "review_recent_learning"]);
  });

  it("disables every learner-required action without a learner", () => {
    const learnerRequired = assistantStarterCatalog.filter((starter) => starter.requiresLearner);
    for (const starter of learnerRequired) {
      expect(resolveAssistantStarter(starter.id, {})).toMatchObject({ disabled: true, disabledReason: "Choose a learner" });
    }
    expect(resolveAssistantStarter("review_recent_learning", {})).toMatchObject({ disabled: false, disabledReason: null });
  });

  it("interpolates the actual learner name and workspace date", () => {
    const prompt = resolveAssistantStarter("organize_today", learnerContext).prompt;
    expect(prompt).toContain("Maya’s lessons");
    expect(prompt).toContain("Thursday, July 16, 2026");
    expect(prompt).not.toContain("selected learner");
  });

  it("interpolates the actual assignment title and subject", () => {
    const prompt = resolveAssistantStarter("teach_next_lesson", assignmentContext).prompt;
    expect(prompt).toContain("Maya’s ‘Pre-Algebra · Lesson 23’ lesson");
    expect(prompt).not.toContain("current item");
  });

  it("keeps family-safe requests explicitly family scoped", () => {
    expect(resolveAssistantStarter("family_briefing", {}).prompt).toContain("each learner");
    expect(resolveAssistantStarter("review_recent_learning", {}).prompt).toContain("family’s recent approved learning records");
    expect(resolveAssistantStarter("plan_week", {}).prompt).toContain("for the family");
  });

  it("emits only intents accepted by the existing agent route", () => {
    const accepted = new Set(supportedAssistantIntents);
    expect(assistantStarterCatalog.every((starter) => accepted.has(starter.intent))).toBe(true);
  });

  it("requires approved evidence and a safe no-op for mistake practice", () => {
    const prompt = resolveAssistantStarter("practice_from_mistakes", assignmentContext).prompt;
    expect(prompt).toContain("approved mistakes");
    expect(prompt).toContain("only reviewed evidence");
    expect(prompt).toContain("skip the practice if there is not enough evidence");
    expect(prompt).toContain("Do not invent a weakness");
    expect(prompt).toContain("correct answers");
  });

  it("protects recent-learning review from unreviewed mastery inference", () => {
    const prompt = resolveAssistantStarter("review_recent_learning", learnerContext).prompt;
    expect(prompt).toContain("approved learning records");
    expect(prompt).toContain("Do not infer mastery from unreviewed work");
  });

  it("preserves curriculum sequence and flags decisions in week planning", () => {
    const prompt = resolveAssistantStarter("plan_week", learnerContext).prompt;
    expect(prompt).toContain("curriculum sequence");
    expect(prompt).toContain("Preserve existing commitments");
    expect(prompt).toContain("flag anything that needs my decision");
  });
});
