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
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByPlaceholder(/Drop in a note/).fill("Read two chapters and compared the characters' choices.");
    await page.locator(".capture-submit").click();
    await expect(page.getByText(/Read two chapters/).first()).toBeVisible();
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
    await page.getByRole("button", { name: "Enter Klio" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByPlaceholder(/Drop in a note/).fill("Today the learner read a short nonfiction passage about pollinators, explained the main idea accurately, and asked why bats can be pollinators too.");
    await page.locator(".capture-submit").click();
    await expect(page.getByRole("button", { name: "Use Klio" })).toBeVisible();
    await page.getByRole("button", { name: "Understand this" }).click();
    await expect(page.locator(".artifact-row").first()).toBeVisible({ timeout: 150_000 });
    await page.locator(".artifact-row").first().click();
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
