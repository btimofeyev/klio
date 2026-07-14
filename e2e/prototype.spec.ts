import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

test("a parent creates a workspace and captures a real note", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const password = "KlioE2e123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("E2E Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("Workspace name").fill("E2E Family");
    await page.getByLabel("Learner’s first name").fill("Learner");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByLabel("Add a subject").selectOption("History");
    await page.getByLabel("Add a subject").selectOption("custom");
    await page.getByLabel("Subject name").fill("Latin");
    await page.getByRole("button", { name: "Add subject" }).click();
    await page.getByLabel("Add a subject").selectOption("custom");
    await page.getByLabel("Subject name").fill("Coding");
    await page.getByRole("button", { name: "Add subject" }).click();
    await page.getByLabel("Latin course or curriculum").fill("Cambridge Latin Course");
    await page.getByLabel("Coding course or curriculum").fill("Python Foundations");
    await page.getByLabel("Math course or curriculum").fill("Algebra I");
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const { data: createdUser } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const createdUserId = createdUser.users.find((user) => user.email === email)?.id;
    const { data: createdFamily } = await admin.from("families").select("id").eq("created_by", createdUserId!).single();
    const { data: savedSubjects } = await admin.from("student_subjects").select("name,course_name").eq("family_id", createdFamily!.id).order("position");
    expect(savedSubjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Math", course_name: "Algebra I" }),
      expect.objectContaining({ name: "History" }),
      expect.objectContaining({ name: "Latin", course_name: "Cambridge Latin Course" }),
      expect.objectContaining({ name: "Coding", course_name: "Python Foundations" }),
    ]));
    const { data: savedCurricula } = await admin.from("curriculum_units").select("subject,title").eq("family_id", createdFamily!.id).order("subject");
    expect(savedCurricula).toEqual(expect.arrayContaining([
      { subject: "Math", title: "Algebra I" },
      { subject: "Latin", title: "Cambridge Latin Course" },
      { subject: "Coding", title: "Python Foundations" },
    ]));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    await page.goto("/app/inbox");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: "worksheet.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    await expect(page.getByText("worksheet.png")).toBeVisible();
    await page.getByPlaceholder(/What happened in learning today/).fill("Read two chapters and compared the characters' choices.");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText("Saving your record…")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("Saved. Klio is putting it away.")).toBeVisible();
    await page.goto("/app/evidence");
    await expect(page.locator(".archive-row").filter({ hasText: /Read two chapters/ })).toBeVisible();
  } finally {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const userId = data.users.find((user) => user.email === email)?.id;
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

test("an authenticated family can start Stripe test checkout", async ({ page }) => {
  test.skip(!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID, "Stripe test credentials are not configured");
  const suffix = crypto.randomUUID();
  const email = `billing-${suffix}@example.test`;
  const password = "KlioBilling123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let customerId: string | null = null;
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Billing Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Billing Family");
    await page.getByLabel("Learner’s first name").fill("Learner");
    await page.getByLabel("Add a subject").selectOption("Math");
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Start membership" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20_000 });
    expect(page.url()).toContain("checkout.stripe.com");

    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const userId = users.users.find((user) => user.email === email)?.id;
    if (userId) {
      const { data: family } = await admin.from("families").select("id").eq("created_by", userId).maybeSingle();
      if (family) {
        const { data: subscription } = await admin.from("subscriptions").select("stripe_customer_id").eq("family_id", family.id).maybeSingle();
        customerId = subscription?.stripe_customer_id ?? null;
      }
    }
  } finally {
    if (customerId) await stripe.customers.del(customerId);
    const matchingCustomers = await stripe.customers.list({ email, limit: 100 });
    for (const customer of matchingCustomers.data) await stripe.customers.del(customer.id);
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const userId = data.users.find((user) => user.email === email)?.id;
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

test("selected evidence becomes a parent-approved OpenAI artifact", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_OPENAI_E2E !== "1", "Set RUN_LIVE_OPENAI_E2E=1 for the live agent verification");
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID();
  const email = `agent-${suffix}@example.test`;
  const password = "KlioAgent123";
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  try {
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Agent Parent");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByLabel("Workspace name").fill("Agent Verification Family");
    await page.getByLabel("Learner’s first name").fill("Learner");
    await page.getByLabel("Add a subject").selectOption("Science");
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/inbox");
    await page.getByPlaceholder(/What happened in learning today/).fill("Today the learner read a short nonfiction passage about pollinators, explained the main idea accurately, and asked why bats can be pollinators too.");
    await page.getByRole("button", { name: "Save to Klio" }).click();
    await expect(page.getByText(/working in the background/i)).toBeVisible();
    await expect(page.locator(".rail-artifact").first()).toBeVisible({ timeout: 150_000 });
    await page.locator(".rail-artifact").first().click();
    await expect(page.getByText("draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("approved", { exact: true })).toBeVisible();
  } finally {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const userId = data.users.find((user) => user.email === email)?.id;
    if (userId) {
      await admin.from("families").delete().eq("created_by", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
