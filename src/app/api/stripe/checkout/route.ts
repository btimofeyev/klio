import { NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import { requireParentApi } from "@/lib/auth/require-parent";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parent = await requireParentApi();
    const form = await request.formData();
    const { familyId } = z.object({ familyId: z.uuid() }).parse(Object.fromEntries(form));
    const supabase = await createClient();
    const { data: membership } = await supabase.from("family_members").select("family_id").eq("family_id", familyId).eq("user_id", parent.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!serverEnv.stripeSecretKey || !serverEnv.stripePriceId) {
      return NextResponse.json({ error: "Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local to enable billing." }, { status: 503 });
    }

    const stripe = new Stripe(serverEnv.stripeSecretKey);
    const admin = createAdminClient();
    const { data: subscription } = await admin.from("subscriptions").select("stripe_customer_id, status").eq("family_id", familyId).maybeSingle();
    if (subscription?.stripe_customer_id && subscription.status === "active") {
      const portal = await stripe.billingPortal.sessions.create({ customer: subscription.stripe_customer_id, return_url: `${serverEnv.appUrl}/app/settings` });
      return NextResponse.redirect(portal.url, 303);
    }

    let customerId = subscription?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: parent.email ?? undefined, metadata: { family_id: familyId, parent_id: parent.id } });
      customerId = customer.id;
      await admin.from("subscriptions").upsert({ family_id: familyId, stripe_customer_id: customerId, status: "inactive" });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription", customer: customerId, line_items: [{ price: serverEnv.stripePriceId, quantity: 1 }],
      success_url: `${serverEnv.appUrl}/app/settings?billing=success`, cancel_url: `${serverEnv.appUrl}/app/settings?billing=cancelled`,
      client_reference_id: familyId, metadata: { family_id: familyId }, subscription_data: { metadata: { family_id: familyId } },
    });
    return NextResponse.redirect(session.url!, 303);
  } catch { return NextResponse.json({ error: "Klio could not begin billing." }, { status: 400 }); }
}
