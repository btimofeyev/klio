import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("a parent checks source-backed Klio suggestions and corrections", async ({ page, request }) => {
  const suffix = crypto.randomUUID();
  const email = `review-${suffix}@example.test`; const password = "KlioReview123";
  const otherEmail = `review-other-${suffix}@example.test`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let userId: string | null = null; let otherUserId: string | null = null;
  try {
    const unauthorized = await request.post("/api/review", { data: { familyId: crypto.randomUUID(), items: [] } });
    expect(unauthorized.status()).toBe(401);
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Review Parent"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Review Family"); await page.getByLabel("Learner’s first name").fill("Maya");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Suggest, then ask", { exact: false }).click();
    await page.getByRole("button", { name: "Enter Klio" }).click(); await expect(page).toHaveURL(/\/app$/);

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = users.data.users.find((user) => user.email === email)?.id ?? null;
    if (!userId) throw new Error("Review user not found");
    const family = await admin.from("families").select("id").eq("created_by", userId).single(); if (family.error) throw family.error;
    const student = await admin.from("students").select("id").eq("family_id", family.data.id).single(); if (student.error) throw student.error;
    const run = await admin.from("agent_runs").insert({ family_id: family.data.id, requested_by: userId, intent: "understand", status: "completed" }).select("id").single(); if (run.error) throw run.error;
    const evidence = await admin.from("evidence_items").insert({ family_id: family.data.id, created_by: userId, kind: "note", title: "Fraction worksheet", raw_text: "Maya compared one half and three fourths, then explained her choice.", processing_status: "ready" }).select("id").single(); if (evidence.error) throw evidence.error;
    const artifact = await admin.from("artifacts").insert({ family_id: family.data.id, student_id: student.data.id, agent_run_id: run.data.id, created_by: userId, type: "practice", title: "Fraction comparison practice", summary: "Three short comparison questions.", rationale: "Maya explained one comparison and may benefit from another example.", content: { overview: "A short practice", uncertainty_flags: ["Only one explanation was available."] }, status: "draft" }).select("id").single(); if (artifact.error) throw artifact.error;
    const observation = await admin.from("skill_observations").insert({ family_id: family.data.id, student_id: student.data.id, author_type: "agent", subject: "Math", skill_key: `fractions-${suffix}`, skill_label: "Compares simple fractions", status: "developing", confidence: .72, rationale: "Maya selected the larger fraction and explained why.", uncertainty_flags: ["This came from one worksheet."], approval_status: "draft" }).select("id").single(); if (observation.error) throw observation.error;
    await admin.from("artifact_sources").insert({ family_id: family.data.id, artifact_id: artifact.data.id, evidence_id: evidence.data.id });
    await admin.from("observation_evidence").insert({ family_id: family.data.id, observation_id: observation.data.id, evidence_id: evidence.data.id });
    const requests = await admin.from("approval_requests").insert([
      { family_id: family.data.id, requested_by_run: run.data.id, entity_type: "artifact", entity_id: artifact.data.id },
      { family_id: family.data.id, requested_by_run: run.data.id, entity_type: "skill_observation", entity_id: observation.data.id },
      { family_id: family.data.id, requested_by_run: run.data.id, entity_type: "artifact", entity_id: crypto.randomUUID() },
    ]).select("id,entity_id"); if (requests.error) throw requests.error;

    const orphan = await admin.from("artifacts").insert({ family_id: family.data.id, student_id: student.data.id, created_by: userId, type: "analysis", title: "Orphan draft must stay hidden", content: {}, status: "draft" }); if (orphan.error) throw orphan.error;
    const otherUser = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true }); if (otherUser.error) throw otherUser.error; otherUserId = otherUser.data.user.id;
    const otherFamily = await admin.from("families").insert({ name: "Other Family", created_by: otherUserId }).select("id").single(); if (otherFamily.error) throw otherFamily.error;
    await admin.from("family_members").insert({ family_id: otherFamily.data.id, user_id: otherUserId, role: "owner" });
    const otherArtifact = await admin.from("artifacts").insert({ family_id: otherFamily.data.id, created_by: otherUserId, type: "analysis", title: "Another family private suggestion", content: {}, status: "draft" }).select("id").single(); if (otherArtifact.error) throw otherArtifact.error;
    await admin.from("approval_requests").insert({ family_id: otherFamily.data.id, entity_type: "artifact", entity_id: otherArtifact.data.id });

    const invalid = await page.evaluate(async () => { const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId: "not-a-uuid", items: [] }) }); return { status: response.status, body: await response.json() }; });
    expect(invalid.status).toBe(400);
    const wrongFamily = await page.evaluate(async (familyId) => { const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items: [{ requestId: crypto.randomUUID(), entityType: "artifact", entityId: crypto.randomUUID(), decision: "approved" }] }) }); return response.status; }, otherFamily.data.id);
    expect(wrongFamily).toBe(403);

    await page.goto("/app/activity");
    await expect(page.getByRole("heading", { name: "What happened" })).toBeVisible();
    await expect(page.getByText("Open any row for its full receipt.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fraction worksheet" })).toBeVisible();
    await expect(page.getByText("Orphan draft must stay hidden")).toHaveCount(0);
    await expect(page.getByText("Another family private suggestion")).toHaveCount(0);
    await expect(page.getByText(/1 older suggestion is no longer available/)).toBeVisible();
    await expect(page.locator('.app-nav a[href="/app/activity"] b')).toHaveText("4");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByText("1 of 1")).toBeVisible();
    let observationCard = page.locator(".review-suggestion").filter({ has: page.getByRole("heading", { name: "Compares simple fractions" }) });
    await observationCard.getByRole("button", { name: "Edit" }).click();
    await observationCard.getByLabel("What Klio noticed").fill("Compares familiar fractions");
    await observationCard.getByRole("button", { name: "Save changes" }).click();
    observationCard = page.locator(".review-suggestion").filter({ has: page.getByRole("heading", { name: "Compares familiar fractions" }) });
    await expect(observationCard).toBeVisible();
    const artifactCard = page.locator(".review-suggestion").filter({ has: page.getByRole("heading", { name: "Fraction comparison practice" }) });
    await expect(artifactCard.getByRole("button", { name: "Edit summary" })).toBeVisible();
    await artifactCard.getByRole("button", { name: "Not quite" }).click();
    await expect(artifactCard.getByRole("button", { name: "Submit correction" })).toBeVisible();
    const navTop = await page.locator(".mobile-nav").evaluate((element) => element.getBoundingClientRect().top);
    const submitBottom = await artifactCard.getByRole("button", { name: "Submit correction" }).evaluate((element) => element.getBoundingClientRect().bottom);
    expect(submitBottom).toBeLessThanOrEqual(navTop);
    await artifactCard.getByRole("button", { name: "Cancel" }).click();

    await observationCard.getByRole("button", { name: "Looks right" }).click();
    await expect(observationCard).toHaveCount(0);
    await expect(artifactCard).toBeVisible();
    await expect(page.locator('.mobile-nav a[href="/app/activity"] b')).toHaveText("3");
    await artifactCard.getByRole("button", { name: "Not quite" }).click();
    await artifactCard.getByLabel("What needs correcting?").selectOption("not_enough_information");
    await artifactCard.getByLabel(/Anything else/).fill("We need another independent sample.");
    await artifactCard.getByRole("button", { name: "Submit correction" }).click();
    await expect(artifactCard).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "1 capture to file" })).toBeVisible();
    await expect(page.locator('.mobile-nav a[href="/app/activity"] b')).toHaveText("2");

    const savedObservation = await admin.from("skill_observations").select("approval_status,skill_label").eq("id", observation.data.id).single();
    expect(savedObservation.data).toEqual({ approval_status: "approved", skill_label: "Compares familiar fractions" });
    const savedArtifact = await admin.from("artifacts").select("status,rejection_reason").eq("id", artifact.data.id).single();
    expect(savedArtifact.data?.status).toBe("rejected");
    expect(JSON.parse(savedArtifact.data?.rejection_reason ?? "{}")).toEqual({ code: "not_enough_information", detail: "We need another independent sample." });

    const observationRequestId = requests.data.find((item) => item.entity_id === observation.data.id)!.id;
    const alreadyDecided = await page.evaluate(async ({ familyId, requestId, entityId }) => { const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items: [{ requestId, entityType: "skill_observation", entityId, decision: "approved" }] }) }); return response.json(); }, { familyId: family.data.id, requestId: observationRequestId, entityId: observation.data.id });
    expect(alreadyDecided.results[0].status).toBe("not_found_or_already_decided");

    const mixedArtifact = await admin.from("artifacts").insert({ family_id: family.data.id, student_id: student.data.id, created_by: userId, type: "analysis", title: "Mixed-result draft", content: {}, status: "draft" }).select("id").single(); if (mixedArtifact.error) throw mixedArtifact.error;
    const mixedRequest = await admin.from("approval_requests").insert({ family_id: family.data.id, entity_type: "artifact", entity_id: mixedArtifact.data.id }).select("id").single(); if (mixedRequest.error) throw mixedRequest.error;
    const staleRequest = requests.data.find((item) => item.entity_id !== observation.data.id && item.entity_id !== artifact.data.id)!;
    const mixed = await page.evaluate(async ({ familyId, validRequestId, validEntityId, staleRequestId, staleEntityId }) => { const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyId, items: [{ requestId: validRequestId, entityType: "artifact", entityId: validEntityId, decision: "approved" }, { requestId: staleRequestId, entityType: "artifact", entityId: staleEntityId, decision: "approved" }] }) }); return response.json(); }, { familyId: family.data.id, validRequestId: mixedRequest.data.id, validEntityId: mixedArtifact.data.id, staleRequestId: staleRequest.id, staleEntityId: staleRequest.entity_id });
    expect(mixed.results.map((result: { status: string }) => result.status)).toEqual(["completed", "not_found_or_already_decided"]);
  } finally {
    if (userId) { await admin.from("families").delete().eq("created_by", userId); await admin.auth.admin.deleteUser(userId); }
    if (otherUserId) { await admin.from("families").delete().eq("created_by", otherUserId); await admin.auth.admin.deleteUser(otherUserId); }
  }
});
