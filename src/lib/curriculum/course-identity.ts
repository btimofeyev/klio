import { createHash } from "node:crypto";
import { z } from "zod";

export type CourseIdentity = {
  publisher: string | null;
  productName: string | null;
  subject: string;
  gradeLabel: string | null;
  editionLabel: string | null;
  isbn: string | null;
  status: "generic" | "recognized" | "verified";
};

export type IdentityAuthority = "parent_input" | "model_prior" | "web_search" | "parent_evidence" | "curated_catalog";

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const identityInputSchema = z.object({
  publisher: text(120), productName: text(200), subject: z.string().trim().min(1).max(80),
  gradeLabel: text(80), editionLabel: text(120), isbn: text(32),
}).strict();

const publisherAliases = new Map([
  ["bju", "BJU Press"], ["bju press", "BJU Press"], ["bob jones university press", "BJU Press"],
]);

export function normalizeCourseIdentity(value: unknown, authority: IdentityAuthority): CourseIdentity {
  const input = identityInputSchema.parse(value);
  const publisher = normalizePublisher(input.publisher);
  const productName = normalizeText(input.productName);
  const gradeLabel = normalizeGrade(input.gradeLabel);
  const editionLabel = normalizeText(input.editionLabel);
  const isbn = normalizeIsbn(input.isbn);
  const recognized = Boolean(publisher || productName);
  const hasVersionEvidence = Boolean(editionLabel || isbn);
  const canVerify = !["model_prior", "web_search"].includes(authority) && (hasVersionEvidence || authority === "curated_catalog");
  return {
    publisher,
    productName,
    subject: normalizeText(input.subject)!,
    gradeLabel,
    editionLabel,
    isbn,
    status: recognized ? (canVerify ? "verified" : "recognized") : "generic",
  };
}

export function inferCourseIdentityFromName(courseName: string, subject: string): CourseIdentity {
  const normalized = normalizeText(courseName) ?? "";
  const publisher = /\b(?:bju|bob jones university)\s*press\b/i.test(normalized) ? "BJU Press" : null;
  const gradeMatch = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+grade\b/i);
  const productName = publisher
    ? normalizeText(normalized.split(/[>›|]/).map((part) => part.trim()).find((part) => part && !/grade|curriculum|bju|bob jones/i.test(part)) ?? subject)
    : null;
  return normalizeCourseIdentity({ publisher, productName, subject, gradeLabel: gradeMatch?.[1] ?? null, editionLabel: null, isbn: null }, "model_prior");
}

export function courseIdentityFingerprint(identity: CourseIdentity) {
  return createHash("sha256").update(JSON.stringify([
    identity.publisher?.toLowerCase() ?? null,
    identity.productName?.toLowerCase() ?? null,
    identity.subject.toLowerCase(),
    identity.gradeLabel?.toLowerCase() ?? null,
    identity.editionLabel?.toLowerCase() ?? null,
    identity.isbn ?? null,
  ])).digest("hex");
}

export function normalizeIsbn(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const isbn = value.toUpperCase().replace(/[^0-9X]/g, "");
  if (!isValidIsbn(isbn)) throw new Error("Enter a valid ISBN-10 or ISBN-13.");
  return isbn;
}

function normalizePublisher(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized ? publisherAliases.get(normalized.toLowerCase()) ?? normalized : null;
}

function normalizeGrade(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+grade)?$/i);
  return match ? `Grade ${Number(match[1])}` : normalized;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function isValidIsbn(value: string) {
  if (/^\d{13}$/.test(value)) return [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0;
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  return [...value].reduce((sum, digit, index) => sum + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0;
}
