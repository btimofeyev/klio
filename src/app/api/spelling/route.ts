import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { checkSpelling } from "@/lib/spelling/check";

export const runtime = "nodejs";

const requestSchema = z.object({
  words: z.array(z.string().trim().min(2).max(40)).max(40),
}).strict();

export async function POST(request: Request) {
  try {
    await requireParentApi();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Check a valid note." }, { status: 400 });
    return NextResponse.json({ issues: checkSpelling(parsed.data.words) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    }
    return NextResponse.json({ error: "Spelling suggestions are unavailable." }, { status: 500 });
  }
}
