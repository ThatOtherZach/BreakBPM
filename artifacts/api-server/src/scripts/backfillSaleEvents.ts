/**
 * Back-fill the `sale_events` ledger from existing data so the ledger is
 * complete from day one. Re-runnable: every insert is ON CONFLICT (provider_ref)
 * DO NOTHING (see recordSaleEventTx), so running it twice never duplicates.
 *
 * Order matters — CRYPTO FIRST. Crypto-purchased passes live in BOTH
 * `crypto_orders` (with tx_hash) and `passes` (source='purchase',
 * source_ref=tx_hash). Recording crypto rows first claims the tx_hash as
 * providerRef, so the later `passes` pass skips them on conflict and only
 * records genuine (non-crypto) Stripe purchases.
 *
 * Run:  pnpm --filter @workspace/api-server run backfill:sale-events
 */
import { eq } from "drizzle-orm";
import {
  db,
  cryptoOrdersTable,
  discountRedemptionsTable,
  discountCodesTable,
  passesTable,
  type PassKind,
} from "@workspace/db";
import {
  recordSaleEventTx,
  valuationForCryptoOrder,
  valuationForCodeRedemption,
  PASS_PRODUCT_LABELS,
} from "../lib/saleEvents";
import { PASS_PRICES_CENTS } from "../lib/pricing";

async function main(): Promise<void> {
  let crypto = 0;
  let redemptions = 0;
  let purchases = 0;

  // 1) Paid crypto orders → crypto_purchase (providerRef = tx_hash).
  const paidOrders = await db
    .select()
    .from(cryptoOrdersTable)
    .where(eq(cryptoOrdersTable.status, "paid"));
  for (const order of paidOrders) {
    if (!order.txHash) continue; // paid but no settling hash → can't key it
    const v = valuationForCryptoOrder(order.passKind, order.priceCents);
    await recordSaleEventTx(db, {
      userId: order.userId,
      eventType: "crypto_purchase",
      paymentMethod: "crypto",
      grossCents: v.grossCents,
      isComp: v.isComp,
      productLabel: v.productLabel,
      providerRef: order.txHash,
      occurredAt: order.updatedAt,
    });
    crypto++;
  }

  // 2) Discount redemptions → code_redemption (providerRef = redemption id).
  const redeemed = await db
    .select({
      id: discountRedemptionsTable.id,
      userId: discountRedemptionsTable.userId,
      redeemedAt: discountRedemptionsTable.redeemedAt,
      grantsPassKind: discountCodesTable.grantsPassKind,
    })
    .from(discountRedemptionsTable)
    .innerJoin(
      discountCodesTable,
      eq(discountRedemptionsTable.code, discountCodesTable.code),
    );
  for (const r of redeemed) {
    const v = valuationForCodeRedemption(r.grantsPassKind);
    await recordSaleEventTx(db, {
      userId: r.userId,
      eventType: "code_redemption",
      paymentMethod: "code",
      grossCents: v.grossCents,
      isComp: v.isComp,
      productLabel: v.productLabel,
      providerRef: r.id,
      occurredAt: r.redeemedAt,
    });
    redemptions++;
  }

  // 3) Purchased passes → stripe_purchase (providerRef = source_ref). Crypto
  //    purchases share this source but their tx_hash was already claimed in
  //    step 1, so they skip on conflict and only Stripe purchases land here.
  const purchased = await db
    .select()
    .from(passesTable)
    .where(eq(passesTable.source, "purchase"));
  for (const pass of purchased) {
    if (!pass.sourceRef) continue;
    const kind = pass.kind as PassKind;
    await recordSaleEventTx(db, {
      userId: pass.userId,
      eventType: "stripe_purchase",
      paymentMethod: "stripe",
      grossCents: pass.priceCents ?? PASS_PRICES_CENTS[kind] ?? 0,
      isComp: false,
      productLabel: PASS_PRODUCT_LABELS[kind] ?? pass.kind,
      providerRef: pass.sourceRef,
      occurredAt: pass.createdAt,
    });
    purchases++;
  }

  console.log(
    `Back-fill complete. Scanned crypto=${crypto}, redemptions=${redemptions}, purchases=${purchases} (existing providerRefs were skipped).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Back-fill failed:", err);
    process.exit(1);
  });
