import type { ReactNode } from "react";
import { useGetAppConfig, useListPlans } from "@workspace/api-client-react";

/** Static plan summaries shown to all visitors (signed-out and signed-in).
 *  Kept in sync with the server pricing catalog for display purposes only. */
const STATIC_PLAN_SUMMARIES = [
  {
    id: "day",
    name: "Day Pass",
    price: "$1.99",
    suffix: "",
    description: "24 hours of full access — stats, history, live spectating.",
  },
  {
    id: "month",
    name: "Month Pass",
    price: "$4.99",
    suffix: "",
    description: "30 days of full access. One-time — does not auto-renew.",
  },
  {
    id: "year",
    name: "Year Pass",
    price: "$14.99",
    suffix: "",
    description: "365 days of full access. One-time — does not auto-renew.",
  },
  {
    id: "lifetime",
    name: "Lifetime",
    price: "$24.99",
    suffix: "",
    description: "One-time purchase. Pay once, full access forever.",
  },
];

interface PricingPanelProps {
  /** When true, each pass card shows a "Buy" button that calls onBuy.
   *  Used by the About page to route visitors to the Passes screen. */
  showBuyButtons?: boolean;
  /** Handler for the per-pass Buy buttons (e.g. navigate to /passes). */
  onBuy?: () => void;
  /** Hide the four static pass cards. Used on the Passes screen, where the
   *  crypto checkout below already lists the buyable passes. */
  hidePassList?: boolean;
  /** Hide the Lucky Break promo notice. Used on the Passes screen, where the
   *  crypto checkout surfaces Lucky Break contextually instead. */
  hideLuckyBreak?: boolean;
  /** Extra content rendered at the bottom of the panel body — e.g. the
   *  Passes screen's "Sign In to Get a Pass" CTA. */
  footer?: ReactNode;
}

/**
 * The public "BreakBPM Passes & Pricing" panel, shared by the Passes screen
 * and the About page so the pricing copy / callouts never drift between them.
 * Reads the off-platform store URL and Lucky Break odds from server config.
 */
export default function PricingPanel({
  showBuyButtons = false,
  onBuy,
  hidePassList = false,
  hideLuckyBreak = false,
  footer,
}: PricingPanelProps) {
  const appConfig = useGetAppConfig();
  const plans = useListPlans();

  // Off-platform card store (Squarespace) for the 14 Day Pass. The callout is
  // hidden entirely until an owner configures BREAKBPM_STORE_URL (server sends
  // "" when unset).
  const storeUrl = appConfig.data?.storeUrl ?? "";
  const luckyBreak = plans.data?.luckyBreak;

  return (
    <div className="panel">
      <div className="panel-header">
        <h1 style={{ margin: 0, fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit", lineHeight: "inherit" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎟️</span>
            BreakBPM Passes &amp; Pricing
          </span>
        </h1>
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 12, margin: 0 }}>
          A pass unlocks full stats history, extended windows, live spectating, and all paid features.
          Free play is always available — sign in to save your stats.
        </p>

        {/* ── Pay-by-card callout (14 Day Pass via Squarespace) ──
            Framed as the card alternative to crypto: deliberately pricier
            so crypto stays the better deal. Only rendered once an owner
            configures the store URL. */}
        {storeUrl && (
          <div
            className="notice"
            style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}
          >
            <span style={{ fontWeight: "bold", fontSize: 12 }}>
              💳 Prefer to pay by card? — 14 Day Pass · $5.99
            </span>
            <span style={{ fontSize: 11 }}>Paying with card? We only sell the 14 Day Pass on the Saym Store. After paying you'll receive a redemption code in 24 hours for 14 days of access. Note that payment with crypto instantly grants access.</span>
            <a
              className="btn btn-primary w-full"
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              Buy 14 Day Pass by Card →
            </a>
          </div>
        )}

        {!hidePassList && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {STATIC_PLAN_SUMMARIES.map((plan) => (
              <div
                key={plan.id}
                style={{
                  border: "1px solid #888",
                  background: "#fff",
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "VT323", fontSize: 22, color: "#000080" }}>{plan.name}</span>
                  <span style={{ fontWeight: "bold" }}>
                    {plan.price}
                    <span style={{ fontWeight: "normal", fontSize: 12 }}>{plan.suffix}</span>
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#444" }}>{plan.description}</div>
                {showBuyButtons && (
                  <button
                    className="btn btn-primary w-full"
                    onClick={onBuy}
                    style={{ marginTop: 2 }}
                  >
                    Buy
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Lucky Break callout — visible to all */}
        {!hideLuckyBreak && (
          <div className="notice" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            <span style={{ fontWeight: "bold", fontSize: 12 }}>🎱 Lucky Break — Roll the Rack</span>
            <span style={{ fontSize: 11 }}>
              A $4.99 guaranteed upgrade: win at minimum a 30-day Monthly Pass, with a&nbsp;
              {luckyBreak?.lifetimeProbability != null
                ? `${Math.round(luckyBreak.lifetimeProbability * 100)}%`
                : "20%"}{" "}
              chance of a Lifetime Pass. Redeem via code — provably fair.
            </span>
          </div>
        )}

        {footer}
      </div>
    </div>
  );
}
