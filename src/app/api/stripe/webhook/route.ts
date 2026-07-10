import { NextResponse } from "next/server";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!serverEnv.stripeSecretKey || !serverEnv.stripeWebhookSecret) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const stripe = new Stripe(serverEnv.stripeSecretKey);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, serverEnv.stripeWebhookSecret); }
  catch { return NextResponse.json({ error: "Invalid signature." }, { status: 400 }); }

  const admin = createAdminClient();
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const familyId = subscription.metadata.family_id;
    if (familyId) {
      const periodEnd = subscription.items.data[0]?.current_period_end;
      await admin.from("subscriptions").upsert({
        family_id: familyId, stripe_customer_id: String(subscription.customer), stripe_subscription_id: subscription.id,
        status: normalizeStatus(subscription.status), price_id: subscription.items.data[0]?.price.id ?? null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      });
    }
  }
  return NextResponse.json({ received: true });
}

function normalizeStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing" || status === "past_due" || status === "unpaid") return status;
  return "canceled" as const;
}
