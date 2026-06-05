import { getUncachableStripeClient } from "./stripeClient";

/**
 * Seed BreakBPM's 4 plans as Stripe Products + Prices.
 *
 * Idempotent: it searches for an existing active Price tagged with the plan's
 * metadata.planId before creating anything, so it's safe to re-run.
 *
 * IMPORTANT: the cents below MUST match the catalog in
 * `artifacts/api-server/src/lib/pricing.ts` (PASS_PRICES_CENTS /
 * SUBSCRIPTION_PRICES_CENTS). The two packages are leaf workspaces and can't
 * import each other, so this is a deliberate hand-kept mirror — update both
 * together when prices change.
 *
 * Run with: pnpm --filter @workspace/scripts run seed:stripe
 */

interface SeedPlan {
  planId: string;
  name: string;
  description: string;
  unitAmount: number;
  recurring?: "month" | "year";
}

const PLANS: SeedPlan[] = [
  {
    planId: "day",
    name: "BreakBPM Day Pass",
    description: "Unlocks unlimited play & full history for 24 hours.",
    unitAmount: 199,
  },
  {
    planId: "monthly",
    name: "BreakBPM Monthly",
    description: "Full access, billed monthly. Cancel anytime.",
    unitAmount: 499,
    recurring: "month",
  },
  {
    planId: "yearly",
    name: "BreakBPM Yearly",
    description: "Best value — full access billed yearly. Cancel anytime.",
    unitAmount: 1499,
    recurring: "year",
  },
  {
    planId: "lifetime",
    name: "BreakBPM Lifetime",
    description: "Pay once, play forever. Includes custom screen names.",
    unitAmount: 2499,
  },
];

async function main() {
  const stripe = await getUncachableStripeClient();
  console.log("Seeding BreakBPM plans into Stripe…");

  for (const plan of PLANS) {
    const existing = await stripe.prices.search({
      query: `metadata['planId']:'${plan.planId}' AND active:'true'`,
    });
    if (existing.data.length > 0) {
      console.log(`✓ ${plan.planId}: price already exists (${existing.data[0].id})`);
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { planId: plan.planId },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.unitAmount,
      currency: "usd",
      ...(plan.recurring ? { recurring: { interval: plan.recurring } } : {}),
      metadata: { planId: plan.planId },
    });
    console.log(
      `＋ ${plan.planId}: created product ${product.id} / price ${price.id} ($${(plan.unitAmount / 100).toFixed(2)}${plan.recurring ? "/" + plan.recurring : " one-time"})`,
    );
  }

  console.log(
    "Done. The managed webhook + syncBackfill will mirror these into the stripe schema.",
  );
}

main().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
