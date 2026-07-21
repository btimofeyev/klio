import { NextResponse } from "next/server";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { normalizeCourseIdentity } from "@/lib/curriculum/course-identity";
import { researchCurriculumBeforeCreation } from "@/lib/curriculum/scope-ingestion";
import { referenceUrlSchema } from "@/lib/security/reference-url";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 90;

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const researchSchema = z.object({
  familyId: z.uuid(),
  title: z.string().trim().min(1, "Add the curriculum name first.").max(200),
  subject: z.string().trim().min(1, "Add the subject first.").max(80),
  publisher: optionalText(120),
  productName: optionalText(200),
  gradeLabel: optionalText(80),
  editionLabel: optionalText(120),
  isbn: optionalText(32),
  curriculumUrl: z.string().trim().transform((value) => value || null).pipe(referenceUrlSchema.nullable()),
}).strict();

const acceptedSourceTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const body = await request.formData();
    const parsed = researchSchema.safeParse({
      familyId: body.get("familyId"),
      title: body.get("title"),
      subject: body.get("subject"),
      publisher: body.get("publisher") ?? "",
      productName: body.get("productName") ?? "",
      gradeLabel: body.get("gradeLabel") ?? "",
      editionLabel: body.get("editionLabel") ?? "",
      isbn: body.get("isbn") ?? "",
      curriculumUrl: body.get("curriculumUrl") ?? "",
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the curriculum details." }, { status: 400 });
    const supabase = await createClient();
    const membership = await supabase.from("family_members").select("family_id").eq("family_id", parsed.data.familyId).eq("user_id", parent.id).in("role", ["owner", "editor"]).maybeSingle();
    if (!membership.data) return NextResponse.json({ error: "You do not have access to this family." }, { status: 403 });
    const identity = normalizeCourseIdentity({
      publisher: parsed.data.publisher,
      productName: parsed.data.productName,
      subject: parsed.data.subject,
      gradeLabel: parsed.data.gradeLabel,
      editionLabel: parsed.data.editionLabel,
      isbn: parsed.data.isbn,
    }, "parent_input");
    const source = body.get("file");
    const sourceContent: ResponseInputContent[] = [];
    if (source instanceof File && source.size > 0) {
      if (!acceptedSourceTypes.has(source.type)) return NextResponse.json({ error: "Upload a JPG, PNG, WebP, or PDF curriculum source." }, { status: 400 });
      if (source.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Curriculum sources must be 20 MB or smaller." }, { status: 413 });
      const encoded = Buffer.from(await source.arrayBuffer()).toString("base64");
      const dataUrl = `data:${source.type};base64,${encoded}`;
      if (source.type === "application/pdf") sourceContent.push({ type: "input_file", filename: source.name || "curriculum.pdf", file_data: dataUrl, detail: "high" });
      else sourceContent.push({ type: "input_image", image_url: dataUrl, detail: "high" });
    }
    const research = await researchCurriculumBeforeCreation({
      familyId: parsed.data.familyId,
      course: {
        title: parsed.data.title,
        subject: parsed.data.subject,
        publisher: identity.publisher,
        productName: identity.productName,
        gradeLabel: identity.gradeLabel,
        editionLabel: identity.editionLabel,
        isbn: identity.isbn,
        identityStatus: identity.status,
        targetLessonCount: 100,
        curriculumUrl: parsed.data.curriculumUrl,
      },
      sourceContent,
    });
    return NextResponse.json({ research });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (error instanceof Error && /ISBN/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message === "OPENAI_KEY_REQUIRED") return NextResponse.json({ error: "Curriculum research is not configured yet." }, { status: 503 });
    return NextResponse.json({ error: "Klio could not confidently research that curriculum. You can still start with 100 generic lessons." }, { status: 500 });
  }
}
