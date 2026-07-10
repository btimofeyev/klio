"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/auth/require-parent";

export type OnboardingState = { error: string | null };

const schema = z.object({
  familyName: z.string().trim().min(1, "Name your family workspace.").max(100),
  studentName: z.string().trim().min(1, "Add your first learner.").max(80),
  gradeBand: z.enum(["pre-k", "k-2", "3-5", "6-8", "9-12", "other"]),
  learningPreferences: z.string().trim().max(2000).optional(),
});

export async function createWorkspaceAction(
  _: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parent = await requireParent();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("user_id", parent.id)
    .limit(1)
    .maybeSingle();
  if (existing) redirect("/app");

  const { data: family, error: familyError } = await supabase
    .from("families")
    .insert({ name: parsed.data.familyName, created_by: parent.id })
    .select("id")
    .single();
  if (familyError) return { error: familyError.message };

  const { error: memberError } = await supabase.from("family_members").insert({
    family_id: family.id,
    user_id: parent.id,
    role: "owner",
  });
  if (memberError) return { error: memberError.message };

  const { error: studentError } = await supabase.from("students").insert({
    family_id: family.id,
    display_name: parsed.data.studentName,
    grade_band: parsed.data.gradeBand,
    learning_preferences: parsed.data.learningPreferences || null,
  });
  if (studentError) return { error: studentError.message };

  redirect("/app");
}
