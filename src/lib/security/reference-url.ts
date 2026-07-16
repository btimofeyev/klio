import { z } from "zod";

export const referenceUrlSchema = z.string().trim().max(2048).transform((value, context) => {
  const normalized = safeReferenceUrl(value);
  if (normalized) return normalized;
  context.addIssue({ code: "custom", message: "Use an http or https reference without embedded credentials." });
  return z.NEVER;
});

export function safeReferenceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
