import { useState, useEffect, useRef } from "react";
import {
  useGetMe,
  useListPlans,
  useCreatePassCheckout,
  useVerifyPassCheckout,
  useCreateSubscriptionCheckout,
  useVerifySubscriptionCheckout,
  useRedeemDiscountCode,
  getGetMeQueryKey,
  type Plan,
  type LuckyBreakResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import LuckyBreakReveal from "./LuckyBreakReveal";
import { signInPath } from "../lib/authClient";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Suffix + recurring sub-line shown under a plan price. */
function priceSuffix(plan: Plan): string {
  if (plan.kind !== "subscription") return "";
  return plan.interval === "month" ? "/mo" : "/yr";
}

function recurringNote(plan: Plan): string | null {
  if (plan.kind !== "subscription") return null;
  return plan.interval === "month"
    ? "Renews monthly · cancel anytime"
    : "Renews yearly · cancel anytime";
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The rack tumbles for at least this long so the seeded draw always feels like
// a genuine roll, even when the server responds instantly.
const MIN_ROLL_MS = 2200;

type RevealState = "idle" | "rolling" | "result";

export default function PassesScreen({ onBack }: { onBack: () => void }) {
  const me = useGetMe();
  const plans = useListPlans();
  const passCheckout = useCreatePassCheckout();
  const passVerify = useVerifyPassCheckout();
  const subCheckout = useCreateSubscriptionCheckout();
  const subVerify = useVerifySubscriptionCheckout();
  const redeem = useRedeemDiscountCode();
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [revealState, setRevealState] = useState<RevealState>("idle");
  const [revealResult, setRevealResult] = useState<LuckyBreakResult | null>(null);

  // Stripe Checkout returns the user to /passes?status=...&type=...&session_id=...
  // We verify once on mount (verify is idempotent server-side and just confirms
  // the entitlement the webhook will/has already granted), surface the result,
  // refresh entitlement, then strip the query string so a refresh doesn't
  // re-trigger it.
  const returnHandled = useRef(false);
  useEffect(() => {
    if (returnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (!status) return;
    returnHandled.current = true;

    const type = params.get("type");
    const sessionId = params.get("session_id");
    const cleanUrl = () =>
      window.history.replaceState({}, "", window.location.pathname);

    if (status === "cancel") {
      setMsg("Checkout canceled — you haven't been charged.");
      cleanUrl();
      return;
    }
    if (status === "success" && sessionId) {
      (async () => {
        try {
          const v =
            type === "sub"
              ? await subVerify.mutateAsync({ data: { opaqueToken: sessionId } })
              : await passVerify.mutateAsync({
                  data: { opaqueToken: sessionId },
                });
          setMsg(v.message);
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        } catch (e) {
          setMsg(
            e instanceof Error
              ? e.message
              : "We couldn't confirm your purchase. If you were charged, it'll activate shortly.",
          );
        } finally {
          cleanUrl();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me.data?.signedIn) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} />
        <div className="app-body">
          <div className="panel">
            <div className="panel-header"><span>Sign In Required</span></div>
            <div className="panel-body">
              <p style={{ fontSize: 13, marginBottom: 10 }}>
                Sign in to redeem a Lucky Break code or buy a pass.
              </p>
              <button
                className="btn btn-primary btn-big w-full"
                onClick={() => { window.location.href = signInPath(); }}
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const busy =
    passCheckout.isPending ||
    passVerify.isPending ||
    subCheckout.isPending ||
    subVerify.isPending;

  const cardPaymentsEnabled = plans.data?.cardPaymentsEnabled ?? false;
  const luckyBreak = plans.data?.luckyBreak;
  const hasAccess =
    !!me.data.entitlement.activePass || !!me.data.entitlement.activeSubscription;

  /**
   * One-time pass purchase. Two-step: createCheckout returns an opaqueToken;
   * the client then calls /passes/verify to confirm and grant. Until a real
   * provider is wired up, createCheckout rejects with a "not configured" note.
   */
  async function handleBuyPass(passKind: "day" | "lifetime") {
    setMsg("");
    try {
      const ck = await passCheckout.mutateAsync({ data: { kind: passKind } });
      if (!ck.success || !ck.opaqueToken) {
        setMsg(ck.message);
        return;
      }
      if (ck.checkoutUrl) {
        window.location.href = ck.checkoutUrl;
        return;
      }
      const v = await passVerify.mutateAsync({ data: { opaqueToken: ck.opaqueToken } });
      setMsg(v.message);
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Purchase failed");
    }
  }

  /** Recurring subscription start. Same two-step shape as a pass purchase but
   * through the dedicated subscription checkout path. */
  async function handleSubscribe(interval: "month" | "year") {
    setMsg("");
    try {
      const ck = await subCheckout.mutateAsync({ data: { interval } });
      if (!ck.success || !ck.opaqueToken) {
        setMsg(ck.message);
        return;
      }
      if (ck.checkoutUrl) {
        window.location.href = ck.checkoutUrl;
        return;
      }
      const v = await subVerify.mutateAsync({ data: { opaqueToken: ck.opaqueToken } });
      setMsg(v.message);
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Subscription failed");
    }
  }

  function handlePlanAction(plan: Plan) {
    if (plan.kind === "subscription" && plan.interval) {
      handleSubscribe(plan.interval);
    } else if (plan.passKind) {
      handleBuyPass(plan.passKind);
    }
  }

  /**
   * Redeem a code. Lucky Break codes resolve to a server-seeded roll, so we
   * play the "rolling the rack" overlay for suspense, enforce a minimum roll
   * duration, then reveal the won tier. Plain codes (e.g. gifted Day/Year/
   * Lifetime passes) skip the animation and just surface their message.
   */
  async function handleRedeem() {
    setMsg("");
    const trimmed = code.trim();
    if (!trimmed) return;

    setRevealResult(null);
    setRevealState("rolling");
    const startedAt = Date.now();

    try {
      const result = await redeem.mutateAsync({ data: { code: trimmed } });
      const isRoll = !!result.luckyBreak;
      const elapsed = Date.now() - startedAt;
      // Always let the rack tumble a beat; longer for an actual roll.
      await delay(Math.max(0, (isRoll ? MIN_ROLL_MS : 500) - elapsed));

      if (result.success) {
        setCode("");
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      }

      if (isRoll && result.luckyBreak) {
        setRevealResult(result.luckyBreak);
        setRevealState("result");
        setMsg(result.message);
      } else {
        setRevealState("idle");
        setMsg(result.message);
      }
    } catch (e) {
      setRevealState("idle");
      setMsg(e instanceof Error ? e.message : "Redeem failed");
    }
  }

  const planList = plans.data?.plans ?? [];
  const lifetimeOdds = luckyBreak
    ? Math.round(luckyBreak.lifetimeProbability * 100)
    : 20;

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} />
      <div className="app-body">

        {/* Lucky Break — the lead unlock. Redeem a $5.99 code to roll the rack. */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true">🎱</span>Lucky Break
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "VT323", fontSize: 26, color: "#000080" }}>
                Roll the Rack
              </span>
              {luckyBreak && (
                <span style={{ fontWeight: "bold" }}>{formatPrice(luckyBreak.priceCents)}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#333", margin: 0 }}>
              Every Lucky Break code is a guaranteed win. You'll always get at
              least a <strong>Monthly Pass</strong> — and there's a{" "}
              <strong>{lifetimeOdds}%</strong> chance the rack breaks your way for
              a <strong>Lifetime Pass</strong>.
            </p>
            <p style={{ fontSize: 10, color: "#666", margin: 0, lineHeight: 1.5 }}>
              Fair play: the draw is <strong>seeded</strong> by the last 30 days
              of shots across all of BreakBPM combined with your code — not
              weighted by it. The odds stay fixed at {lifetimeOdds}% no matter how
              anyone shoots.
            </p>

            {hasAccess ? (
              <div style={{ fontFamily: "VT323", fontSize: 20, color: "#006400" }}>
                You already have active access — save your roll for later.
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="ENTER LUCKY BREAK CODE"
                  maxLength={64}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  disabled={redeem.isPending || revealState !== "idle"}
                />
                <button
                  className="btn btn-primary btn-big"
                  disabled={redeem.isPending || revealState !== "idle" || !code.trim()}
                  onClick={handleRedeem}
                >
                  {revealState === "rolling" ? "Rolling…" : "Roll the Rack 🎱"}
                </button>
                <p style={{ fontSize: 10, color: "#888", margin: 0 }}>
                  Have a gifted Day, Year, or Lifetime code? Enter it here too.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Card purchase — turned off behind an env flag while we run on codes
            only. The endpoints + UI stay intact so this can flip back on. */}
        {cardPaymentsEnabled && (
          <div className="panel">
            <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎟️</span>Get a Pass</span></div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {plans.isLoading && <p style={{ fontSize: 12 }}>Loading plans…</p>}
              {planList.map((plan) => {
                const note = recurringNote(plan);
                return (
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
                        {formatPrice(plan.priceCents)}
                        <span style={{ fontWeight: "normal", fontSize: 12 }}>{priceSuffix(plan)}</span>
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#444" }}>{plan.description}</div>
                    {note && (
                      <div style={{ fontSize: 10, color: "#006400" }}>↻ {note}</div>
                    )}
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => handlePlanAction(plan)}
                    >
                      {plan.kind === "subscription" ? "Subscribe" : "Buy"}
                    </button>
                  </div>
                );
              })}
              <p style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                Pay securely by card via Stripe. Prefer a code? Redeem one above.
              </p>
            </div>
          </div>
        )}

        {msg && (
          <div className="notice"><span>ℹ</span><span>{msg}</span></div>
        )}
      </div>

      {revealState !== "idle" && (
        <LuckyBreakReveal
          phase={revealState === "rolling" ? "rolling" : "result"}
          result={revealResult}
          onClose={() => setRevealState("idle")}
        />
      )}
    </div>
  );
}
