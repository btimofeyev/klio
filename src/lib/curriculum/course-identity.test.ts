import { describe, expect, it } from "vitest";
import { courseIdentityFingerprint, inferCourseIdentityFromName, normalizeCourseIdentity } from "./course-identity";

describe("course identity", () => {
  it("recognizes BJU Press English 7 while leaving edition unknown", () => {
    expect(inferCourseIdentityFromName("7th grade > English > Curriculum > BJU Press", "Language Arts")).toMatchObject({ publisher: "BJU Press", productName: "English", gradeLabel: "Grade 7", editionLabel: null, status: "recognized" });
  });

  it("normalizes publisher aliases and casing", () => {
    expect(normalizeCourseIdentity({ publisher: " bob  jones university press ", productName: "english 7", subject: "Language Arts", gradeLabel: "7", editionLabel: null, isbn: null }, "parent_input")).toMatchObject({ publisher: "BJU Press", productName: "english 7", gradeLabel: "Grade 7", status: "recognized" });
  });

  it("allows validated parent version details to verify identity", () => {
    expect(normalizeCourseIdentity({ publisher: "BJU", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "4th edition", isbn: "978-0-306-40615-7" }, "parent_input")).toMatchObject({ isbn: "9780306406157", status: "verified" });
  });

  it("rejects an invalid ISBN before identity can be persisted", () => {
    expect(() => normalizeCourseIdentity({ publisher: "BJU", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: null, isbn: "978-0-306-40615-8" }, "parent_input")).toThrow("Enter a valid ISBN-10 or ISBN-13.");
  });

  it("downgrades model claims of a verified edition", () => {
    expect(normalizeCourseIdentity({ publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "7", editionLabel: "4th edition", isbn: "9780306406157" }, "model_prior").status).toBe("recognized");
  });

  it("keeps editions distinct in fingerprints", () => {
    const base = { publisher: "BJU Press", productName: "English", subject: "Language Arts", gradeLabel: "Grade 7", isbn: null };
    const a = normalizeCourseIdentity({ ...base, editionLabel: "3rd" }, "parent_input");
    const b = normalizeCourseIdentity({ ...base, editionLabel: "4th" }, "parent_input");
    expect(courseIdentityFingerprint(a)).not.toBe(courseIdentityFingerprint(b));
  });

  it("falls back to generic when identity is ambiguous", () => {
    expect(inferCourseIdentityFromName("A course we like", "Art").status).toBe("generic");
  });
});
