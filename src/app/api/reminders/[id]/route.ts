import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  status: z.enum(["pending", "completed", "dismissed"]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: z.iso.datetime().nullable().optional(),
}).refine((value) => value.status !== undefined || value.title !== undefined || value.dueAt !== undefined, "Add a reminder change.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireParentApi();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose a valid reminder update." }, { status: 400 });
    const supabase = await createClient();
    const updates: { status?: "pending" | "completed" | "dismissed"; completed_at?: string | null; title?: string; due_at?: string | null } = {};
    if (parsed.data.status !== undefined) { updates.status = parsed.data.status; updates.completed_at = parsed.data.status === "completed" ? new Date().toISOString() : null; }
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.dueAt !== undefined) updates.due_at = parsed.data.dueAt;
    const { data, error } = await supabase.from("reminders").update(updates).eq("id", id).select("id, status, title, due_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.json({ error: "Klio could not update that reminder." }, { status: 500 });
  }
}
