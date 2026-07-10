import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const getCurrentParent = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
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
