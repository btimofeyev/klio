import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const getCurrentParent = cache(async () => {
  const supabase = await createClient();
  // getUser() verifies the session against the Auth server. A locally valid JWT
  // can outlive a deleted auth.users row, so claims alone are not sufficient for
  // mutations that reference auth.users through foreign keys.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
  };
});

export async function requireParent() {
  const parent = await getCurrentParent();
  if (!parent) redirect("/login");
  return parent;
}

export async function requireParentApi() {
  const parent = await getCurrentParent();
  if (!parent) throw new Error("UNAUTHORIZED");
  return parent;
}
