import { useState } from "react";
import {
  useGetMe,
  usePurchasePass,
  useRedeemDiscountCode,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const TIERS = [
  { kind: "day" as const, label: "Day Pass", price: "$1.99", desc: "Unlocks unlimited play & full history for 24h" },
  { kind: "year" as const, label: "Year Pass", price: "$12.99", desc: "Best value for regular players" },
  { kind: "lifetime" as const, label: "Lifetime", price: "$19.99", desc: "Pay once, play forever" },
];

export default function PassesScreen({ onBack }: { onBack: () => void }) {
  const me = useGetMe();
  const purchase = usePurchasePass();
  const redeem = useRedeemDiscountCode();
  const qc = useQueryClient();

  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (!me.data?.signedIn) {
    return (
      <div className="app-window">
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
                onClick={() => { window.location.href = `${basePath}/sign-in`; }}
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleBuy(kind: "day" | "year" | "lifetime") {
    setMsg("");
    try {
      const result = await purchase.mutateAsync({ data: { kind } });
      setMsg(result.message);
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Purchase failed");
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

  return (
    <div className="app-window">
      <Navbar onBack={onBack} />
      <div className="app-body">

        <div className="panel">
          <div className="panel-header"><span>🎟 Get a Pass</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TIERS.map((t) => (
              <div
                key={t.kind}
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
                  <span style={{ fontFamily: "VT323", fontSize: 22, color: "#000080" }}>{t.label}</span>
                  <span style={{ fontWeight: "bold" }}>{t.price}</span>
                </div>
                <div style={{ fontSize: 11, color: "#444" }}>{t.desc}</div>
                <button
                  className="btn btn-primary"
                  disabled={purchase.isPending}
                  onClick={() => handleBuy(t.kind)}
                >
                  Buy
                </button>
              </div>
            ))}
            <p style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
              Note: payments are stubbed in this build — Buy grants the pass for free.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><span>🏷 Redeem Code</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
          </div>
        </div>

        {msg && (
          <div className="notice"><span>ℹ</span><span>{msg}</span></div>
        )}
      </div>
    </div>
  );
}
