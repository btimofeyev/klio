import "server-only";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get openAiApiKey() {
    return process.env.OPENAI_API_KEY || null;
  },
  get openAiModel() {
    return process.env.OPENAI_MODEL || "gpt-5.6-terra";
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  },
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY || null;
  },
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || null;
  },
  get stripePriceId() {
    return process.env.STRIPE_PRICE_ID || null;
  },
};
