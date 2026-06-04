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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
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
                Sign in to redeem codes or buy a pass.
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

  async function handleRedeem() {
    setMsg("");
    if (!code.trim()) return;
    try {
      const result = await redeem.mutateAsync({ data: { code: code.trim() } });
      setMsg(result.message);
      if (result.success) setCode("");
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Redeem failed");
    }
  }

  const planList = plans.data?.plans ?? [];

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} />
      <div className="app-body">

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
              Pay securely by card via Stripe. Prefer a code? Redeem a discount code below.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎁</span>Redeem Code</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {me.data.entitlement.activePass || me.data.entitlement.activeSubscription ? (
              // We hide the input entirely when entitlement is already active so
              // a recipient with, say, a gifted Day Pass can't accidentally
              // burn a second code. The server also enforces this — see the
              // pre-check in /passes/redeem.
              <>
                <div style={{ fontFamily: "VT323", fontSize: 22, color: "#006400" }}>
                  {me.data.entitlement.activeSubscription ? "Subscription Active" : "Pass Active"}
                </div>
                <p style={{ fontSize: 12, color: "#444" }}>
                  You already have active access — no need to redeem a code
                  right now.
                </p>
              </>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="ENTER CODE"
                  maxLength={64}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <button
                  className="btn btn-primary btn-big"
                  disabled={redeem.isPending || !code.trim()}
                  onClick={handleRedeem}
                >
                  Redeem
                </button>
              </>
            )}
          </div>
        </div>

        {msg && (
          <div className="notice"><span>ℹ</span><span>{msg}</span></div>
        )}
      </div>
    </div>
  );
}
