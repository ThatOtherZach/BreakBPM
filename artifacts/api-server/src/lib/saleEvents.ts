import {
  db,
  saleEventsTable,
  type PassKind,
  type SaleEventType,
  type SalePaymentMethod,
} from "@workspace/db";
import { newId } from "./ids";
import { computeTaxInclusive } from "./tax";
import { convertUsdToCad, type UsdCadRate } from "./fx";
import { LUCKY_BREAK_PRICE_CENTS } from "./pricing";
import { LUCKY_BREAK_CODE_KIND } from "./luckyBreak";

/** Human-readable product labels for the ledger, by pass kind. */
export const PASS_PRODUCT_LABELS: Record<PassKind, string> = {
  day: "Day Pass",
  month: "Month Pass",
  year: "Year Pass",
  lifetime: "Lifetime Pass",
};

export const LUCKY_BREAK_PRODUCT_LABEL = "Lucky Break";

/** The CAD value (cents) + comp flag + display label for one sale. */
export interface SaleValuation {
  grossCents: number;
  isComp: boolean;
  productLabel: string;
}

/** Map a pass-kind-or-`lucky_break` sentinel to a display label. */
function labelForGrantKind(grantKind: string): string {
  if (grantKind === LUCKY_BREAK_CODE_KIND) return LUCKY_BREAK_PRODUCT_LABEL;
  return PASS_PRODUCT_LABELS[grantKind as PassKind] ?? grantKind;
}

/**
 * Sale value for a CRYPTO order. Crypto is always a real (paid) sale. For a
 * Lucky Break order the recorded value is what was actually paid (the Lucky
 * Break price, snapshotted on the order as `priceCents`), NOT the catalog price
 * of the won tier; for a fixed pass it is the order's `priceCents`.
 */
export function valuationForCryptoOrder(
  orderPassKind: string,
  priceCents: number,
): SaleValuation {
  return {
    grossCents: priceCents,
    isComp: false,
    productLabel: labelForGrantKind(orderPassKind),
  };
}

/**
 * Sale value for a CODE redemption — the one non-trivial rule. A Lucky Break
 * code is a real sale valued at the Lucky Break price. Every other code
 * (admin comp / Day-Pass gift / boot-time seed) is a COMP: recorded at $0 and
 * flagged so it shows in the ledger but contributes nothing to revenue.
 *
 * `issuerKind` is the minting flow (see discount_codes.issuerKind). Free-pass
 * CLAIM codes (`issuerKind = 'claim'`, the landing-page giveaway) are ALWAYS a
 * $0 comp — even for the Lucky Break draw kind — because the player paid
 * nothing. Without this carve-out a free Lucky Break giveaway would falsely
 * book the Lucky Break price as paid revenue.
 */
export function valuationForCodeRedemption(
  grantsPassKind: string,
  issuerKind?: string | null,
): SaleValuation {
  if (issuerKind === "claim") {
    return {
      grossCents: 0,
      isComp: true,
      productLabel: labelForGrantKind(grantsPassKind),
    };
  }
  if (grantsPassKind === LUCKY_BREAK_CODE_KIND) {
    return {
      grossCents: LUCKY_BREAK_PRICE_CENTS,
      isComp: false,
      productLabel: LUCKY_BREAK_PRODUCT_LABEL,
    };
  }
  return {
    grossCents: 0,
    isComp: true,
    productLabel: labelForGrantKind(grantsPassKind),
  };
}

export interface RecordSaleEventInput {
  userId: string | null;
  eventType: SaleEventType;
  paymentMethod: SalePaymentMethod;
  /** The amount actually paid, in USD cents (the catalog/charge currency). */
  grossCents: number;
  isComp: boolean;
  productLabel: string;
  /**
   * USD→CAD rate (from fx.ts), fetched by the caller BEFORE opening the tx so
   * the network call never runs inside the transaction. Frozen onto the row.
   */
  fx: UsdCadRate;
  /** Idempotency key (tx hash / payment-intent / invoice / redemption id). */
  providerRef: string;
  occurredAt?: Date;
}

/**
 * Insert one fully-valued, taxed sale row inside a caller-provided transaction.
 * The source USD amount is converted to CAD using the caller-supplied BoC rate,
 * tax is computed on the CAD gross (once) and frozen into the stored columns,
 * and the source amount + rate are persisted for audit. The insert is
 * `ON CONFLICT (provider_ref) DO NOTHING` so duplicate webhook/verify
 * deliveries — and a re-run of the back-fill — are harmless no-ops.
 */
export async function recordSaleEventTx(
  tx: Pick<typeof db, "insert">,
  input: RecordSaleEventInput,
): Promise<void> {
  const cadGrossCents = convertUsdToCad(input.grossCents, input.fx.rateMicros);
  const tax = computeTaxInclusive(cadGrossCents);
  await tx
    .insert(saleEventsTable)
    .values({
      id: newId(),
      userId: input.userId,
      eventType: input.eventType,
      productLabel: input.productLabel,
      paymentMethod: input.paymentMethod,
      isComp: input.isComp,
      grossCents: cadGrossCents,
      gstCents: tax.gstCents,
      pstCents: tax.pstCents,
      netCents: tax.netCents,
      gstRateBps: tax.gstRateBps,
      pstRateBps: tax.pstRateBps,
      sourceGrossCents: input.grossCents,
      sourceCurrency: "USD",
      fxRateMicros: input.fx.rateMicros,
      fxRateDate: input.fx.rateDate,
      fxSource: input.fx.source,
      providerRef: input.providerRef,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: saleEventsTable.providerRef });
}
