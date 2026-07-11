import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  status: z.enum(["pending", "completed", "dismissed"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose a valid reminder update." }, { status: 400 });
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders").update({
      status: parsed.data.status,
      completed_at: parsed.data.status === "completed" ? new Date().toISOString() : null,
    }).eq("id", id).select("id, status").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that reminder." }, { status: 500 });
  }
}
