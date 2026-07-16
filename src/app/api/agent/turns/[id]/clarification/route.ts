import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { answerWorkspaceClarification } from "@/lib/agent/workspace/clarification";

const schema = z.object({ answer: z.string().trim().min(1).max(4000), requestId: z.uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parent = await requireParentApi();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Add one concise answer." }, { status: 400 });
    const result = await answerWorkspaceClarification({ turnId: (await context.params).id, parentId: parent.id, ...parsed.data });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLARIFICATION_FAILED";
    if (code === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    if (code === "CLARIFICATION_FORBIDDEN") return NextResponse.json({ error: "Question not found." }, { status: 404 });
    if (["CLARIFICATION_CANCELLED", "CLARIFICATION_NOT_WAITING"].includes(code)) return NextResponse.json({ error: "This question is no longer waiting for an answer." }, { status: 409 });
    if (code === "CLARIFICATION_NOT_FOUND") return NextResponse.json({ error: "Question not found." }, { status: 404 });
    return NextResponse.json({ error: "Klio could not save that answer." }, { status: 500 });
  }
}
