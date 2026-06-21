import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdPricing,
  useCreateAdQuote,
  useVerifyCryptoPayment,
  useListMyAds,
  getListMyAdsQueryKey,
  type AdCryptoOrder,
  type AdQuoteInputAsset,
  type MyAd,
} from "@workspace/api-client-react";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LS_KEY = "breakbpm.adcrypto.pending";
/** ~3 min of polling at 4s intervals — comfortably covers Base confirmations. */
const MAX_POLLS = 45;
const POLL_MS = 4000;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const HEADLINE_MAX = 60;
const TAGLINE_MAX = 120;

type Phase =
  | "idle"
  | "quoting"
  | "awaiting_payment"
  | "confirming"
  | "done"
  | "error";

interface Pending {
  orderId: string;
  /** Omitted for manual USDC orders, which the server auto-detects by amount. */
  txHash?: string;
  /** The full manual quote, persisted so a refresh can restore the pay screen. */
  order?: AdCryptoOrder;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const anyErr = e as { shortMessage?: string; message?: string };
    if (anyErr.shortMessage) return anyErr.shortMessage;
    if (anyErr.message) return anyErr.message;
  }
  return "Something went wrong.";
}

/** EIP-681 payment URI — what the QR encodes (mirrors the pass checkout). */
function paymentUri(order: AdCryptoOrder): string {
  if (order.asset === "eth") {
    return `ethereum:${order.receivingAddress}@${order.chainId}?value=${order.expectedAmount}`;
  }
  return `ethereum:${order.tokenAddress}@${order.chainId}/transfer?address=${order.receivingAddress}&uint256=${order.expectedAmount}`;
}

/** Numeric part of "1.23 USDC" — what we copy so it pastes cleanly as an amount. */
function amountValue(displayAmount: string): string {
  return displayAmount.split(" ")[0] ?? displayAmount;
}

/** Buyer-facing display state, including a derived "expired" the API doesn't store. */
type DisplayStatus = MyAd["status"] | "expired";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending_review: "In review",
  approved: "Live",
  denied: "Declined",
  expired: "Expired",
};

const STATUS_COLOR: Record<DisplayStatus, string> = {
  pending_review: "#9a7a00",
  approved: "#006400",
  denied: "#a00",
  expired: "#666",
};

/**
 * An approved ad whose window has elapsed shows as "expired" (it has fallen out
 * of the active-ads rotation server-side). Expiry is derived from `expiryAt`
 * client-side since the stored status stays "approved".
 */
function displayStatus(ad: MyAd): DisplayStatus {
  if (ad.status === "approved" && ad.expiryAt && new Date(ad.expiryAt) <= new Date()) {
    return "expired";
  }
  return ad.status;
}

/**
 * Signed-in panel to buy your own HUD text ad. Compose a headline + tagline,
 * pick a run length (days), get a live price (the per-day rate floats with
 * demand and is frozen into the quote), pay in crypto, then watch it move
 * through admin review on the "Your ads" list below. The ad row is created only
 * after payment confirms (server-side, on /crypto/verify), landing in
 * `pending_review` until an admin approves it.
 */
export default function AdPurchasePanel() {
  const qc = useQueryClient();
  const pricing = useGetAdPricing();
  const createQuote = useCreateAdQuote();
  const verify = useVerifyCryptoPayment();
  const myAds = useListMyAds({
    query: { queryKey: getListMyAdsQueryKey() },
  });

  const cryptoEnabled = pricing.data?.cryptoEnabled ?? false;
  const dailyCents = pricing.data?.effectiveDailyCents ?? 0;
  const maxDays = pricing.data?.maxDays ?? 369;

  const [headline, setHeadline] = useState("");
  const [tagline, setTagline] = useState("");
  const [days, setDays] = useState(7);
  const [asset, setAsset] = useState<AdQuoteInputAsset>("usdc");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [manualOrder, setManualOrder] = useState<AdCryptoOrder | null>(null);
  const [txHashInput, setTxHashInput] = useState("");
  const [showHashInput, setShowHashInput] = useState(false);
  const [copied, setCopied] = useState("");

  // Surface a resumable payment saved before a refresh / accidental close.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setPending(JSON.parse(raw) as Pending);
    } catch {
      /* ignore malformed */
    }
  }, []);

  function savePending(p: Pending | null) {
    setPending(p);
    try {
      if (p) localStorage.setItem(LS_KEY, JSON.stringify(p));
      else localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — value still visible */
    }
  }

  const estTotalCents = dailyCents * days;
  const networkLabel =
    manualOrder?.network === "base-sepolia"
      ? "Base Sepolia (testnet)"
      : "Base";

  async function pollVerify(orderId: string, txHash?: string) {
    setPhase("confirming");
    for (let i = 0; i < MAX_POLLS; i++) {
      let v;
      try {
        v = await verify.mutateAsync({
          data: txHash ? { orderId, txHash } : { orderId },
        });
      } catch (e) {
        setErr(errText(e));
        setPhase("error");
        return;
      }
      if (v.status === "granted") {
        savePending(null);
        setProgress(v.message);
        setPhase("done");
        setManualOrder(null);
        void qc.invalidateQueries({ queryKey: getListMyAdsQueryKey() });
        return;
      }
      if (
        v.status === "mismatch" ||
        v.status === "failed" ||
        v.status === "expired"
      ) {
        if (v.status !== "expired") savePending(null);
        setErr(v.message);
        setPhase("error");
        return;
      }
      // pending / not_found → keep waiting (manual USDC auto-detect lands here
      // until the transfer is seen on-chain).
      setProgress(v.message);
      await delay(POLL_MS);
    }
    setErr(
      "Still confirming. Your ad will be submitted automatically once the transaction settles — check back shortly.",
    );
    setPhase("error");
  }

  async function handleGetDetails() {
    setErr("");
    setProgress("");
    setManualOrder(null);
    setTxHashInput("");
    setShowHashInput(false);
    if (!headline.trim() || !tagline.trim()) {
      setErr("Add a headline and a tagline for your ad.");
      setPhase("error");
      return;
    }
    setPhase("quoting");
    try {
      const q = await createQuote.mutateAsync({
        data: { headline: headline.trim(), tagline: tagline.trim(), days, asset },
      });
      if (!q.success || !q.order) {
        setErr(q.message);
        setPhase("error");
        return;
      }
      setManualOrder(q.order);
      savePending({ orderId: q.order.id, order: q.order });
      setPhase("awaiting_payment");
    } catch (e) {
      setErr(errText(e));
      setPhase("error");
    }
  }

  async function handleConfirmManual(order: AdCryptoOrder) {
    setErr("");
    const h = txHashInput.trim();
    if (order.asset === "eth" || h) {
      if (!HASH_RE.test(h)) {
        setErr("Enter the transaction hash from your wallet.");
        return;
      }
      savePending({ orderId: order.id, txHash: h.toLowerCase(), order });
      await pollVerify(order.id, h.toLowerCase());
    } else {
      await pollVerify(order.id);
    }
  }

  function resetCheckout() {
    setManualOrder(null);
    setPhase("idle");
    setProgress("");
    setErr("");
    setTxHashInput("");
    setShowHashInput(false);
    savePending(null);
  }

  async function handleResume() {
    if (!pending) return;
    setErr("");
    if (pending.txHash) {
      await pollVerify(pending.orderId, pending.txHash);
      return;
    }
    if (pending.order) {
      setManualOrder(pending.order);
      setProgress("");
      setTxHashInput("");
      setShowHashInput(false);
      setPhase("awaiting_payment");
      return;
    }
    await pollVerify(pending.orderId);
  }

  const busy = phase === "quoting" || phase === "confirming";
  const locked = busy || phase === "awaiting_payment";
  const showingOrder =
    !!manualOrder && (phase === "awaiting_payment" || phase === "confirming");

  const ads = myAds.data?.ads ?? [];

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true">📣</span>Buy a HUD Ad
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <p style={{ fontSize: 12, color: "#333", margin: 0 }}>
          Show a text ad (a bold headline + tagline) in the live game HUD to
          non-paying players. Pick how many days it runs, pay in crypto, and an
          admin reviews it before it goes live. Sponsored by your screen name.
        </p>

        {pricing.isLoading ? (
          <p style={{ fontSize: 12, color: "#666", margin: 0 }}>Loading pricing…</p>
        ) : !cryptoEnabled ? (
          <div className="notice" style={{ fontSize: 12 }}>
            Crypto checkout is closed right now — ad purchases are unavailable.
          </div>
        ) : phase !== "done" && !showingOrder ? (
          <>
            {/* Compose */}
            <label className="avp-field">
              Headline
              <input
                className="input"
                value={headline}
                maxLength={HEADLINE_MAX}
                disabled={locked}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Corner Pocket Billiards"
              />
            </label>
            <label className="avp-field">
              Tagline
              <input
                className="input"
                value={tagline}
                maxLength={TAGLINE_MAX}
                disabled={locked}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="$5 tables all day Tuesday — downtown"
              />
            </label>

            {/* Live preview as it'll read in the HUD */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                padding: 8,
                border: "1px dashed #6a3a9a",
                background: "#0a0a1e",
                borderRadius: 4,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "#7a6a9a",
                }}
              >
                Ad
              </span>
              <span style={{ fontSize: 16, fontWeight: "bold", color: "#e8c8ff" }}>
                {headline.trim() || "Your headline"}
              </span>
              <span style={{ fontSize: 13, color: "#b89ad8" }}>
                {tagline.trim() || "Your tagline goes here"}
              </span>
            </div>

            {/* Days */}
            <label className="avp-field">
              Run length: <strong>{days}</strong> {days === 1 ? "day" : "days"}
              <input
                type="range"
                min={1}
                max={maxDays}
                value={days}
                disabled={locked}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>

            {/* Asset toggle */}
            <div className="crypto-field">
              <span className="crypto-field-label">Pay with</span>
              <div className="crypto-assets">
                {(["usdc", "eth"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={asset === a ? "btn btn-primary" : "btn"}
                    style={{ textTransform: "uppercase" }}
                    disabled={locked}
                    aria-pressed={asset === a}
                    onClick={() => setAsset(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#333" }}>
              About{" "}
              <strong>{formatPrice(estTotalCents)}</strong>{" "}
              <span style={{ color: "#888" }}>
                ({formatPrice(dailyCents)}/day × {days}) — final amount is locked
                when you get the quote.
              </span>
            </div>

            <div
              className="notice"
              style={{ fontSize: 12, color: "#7a2a00", lineHeight: 1.35 }}
            >
              <strong>Crypto payments are non-refundable</strong> — you pay upfront,
              then an admin reviews your ad; if it's approved it goes live for your
              chosen days, and if it's denied it never displays — your payment is
              kept either way, with no refunds, including on denial.
            </div>

            <button
              className="btn btn-primary btn-big"
              disabled={busy}
              onClick={handleGetDetails}
            >
              {phase === "quoting"
                ? "Getting a quote…"
                : `Pay with ${asset.toUpperCase()}`}
            </button>
          </>
        ) : null}

        {showingOrder && manualOrder ? (
          <div className="crypto-pay">
            <p style={{ fontSize: 12, color: "#333", margin: 0 }}>
              Send <strong>exactly</strong> this amount to the address below for a{" "}
              <strong>
                {manualOrder.days}-day
              </strong>{" "}
              ad ({formatPrice(manualOrder.priceCents)}). The exact amount is how
              we match your payment.
            </p>
            <div className="crypto-pay__amount">
              <span className="crypto-pay__label">Send exactly</span>
              <span className="crypto-pay__value">{manualOrder.displayAmount}</span>
              <button
                type="button"
                className="btn"
                style={{ fontSize: 11, minHeight: 28 }}
                onClick={() =>
                  copy(amountValue(manualOrder.displayAmount), "amount")
                }
              >
                {copied === "amount" ? "Copied!" : "Copy amount"}
              </button>
            </div>
            <div className="crypto-pay__amount">
              <span className="crypto-pay__label">To address</span>
              <span
                className="crypto-pay__value"
                style={{ wordBreak: "break-all", fontSize: 13 }}
              >
                {manualOrder.receivingAddress}
              </span>
              <button
                type="button"
                className="btn"
                style={{ fontSize: 11, minHeight: 28 }}
                onClick={() => copy(manualOrder.receivingAddress, "addr")}
              >
                {copied === "addr" ? "Copied!" : "Copy address"}
              </button>
            </div>
            <div className="crypto-pay__qr">
              <div style={{ background: "#fff", padding: 10, borderRadius: 6 }}>
                <QRCodeSVG value={paymentUri(manualOrder)} size={168} />
              </div>
              <span style={{ fontSize: 11, color: "#888" }}>
                On a computer? Scan with a mobile wallet on {networkLabel}
              </span>
            </div>
            <a
              className="btn btn-big crypto-walletlink"
              href={paymentUri(manualOrder)}
              target="_top"
              rel="noopener noreferrer"
              aria-label="Open payment request in an installed wallet app"
            >
              <span aria-hidden="true">📱 </span>Open in wallet app
            </a>
            {manualOrder.asset === "eth" ? (
              <div className="crypto-field">
                <span className="crypto-field-label">
                  After sending, paste your transaction hash
                </span>
                <input
                  className="crypto-input"
                  placeholder="0x…"
                  value={txHashInput}
                  disabled={busy}
                  onChange={(e) => setTxHashInput(e.target.value)}
                />
                <button
                  className="btn btn-primary btn-big"
                  disabled={busy}
                  onClick={() => handleConfirmManual(manualOrder)}
                >
                  {phase === "confirming" ? "Confirming…" : "Confirm payment"}
                </button>
              </div>
            ) : (
              <>
                <button
                  className="btn btn-primary btn-big"
                  disabled={busy}
                  onClick={() => handleConfirmManual(manualOrder)}
                >
                  {phase === "confirming"
                    ? "Checking for your payment…"
                    : "I've paid — confirm"}
                </button>
                {!showHashInput ? (
                  <button
                    type="button"
                    className="crypto-linkbtn"
                    disabled={busy}
                    onClick={() => setShowHashInput(true)}
                  >
                    Paid from an exchange? Paste the transaction hash
                  </button>
                ) : (
                  <div className="crypto-field">
                    <span className="crypto-field-label">Transaction hash</span>
                    <input
                      className="crypto-input"
                      placeholder="0x…"
                      value={txHashInput}
                      disabled={busy}
                      onChange={(e) => setTxHashInput(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => handleConfirmManual(manualOrder)}
                    >
                      Confirm with hash
                    </button>
                  </div>
                )}
              </>
            )}
            <button
              type="button"
              className="crypto-linkbtn"
              disabled={busy}
              onClick={resetCheckout}
            >
              Start over
            </button>
          </div>
        ) : null}

        {/* Resume an interrupted payment */}
        {pending && !showingOrder && phase !== "confirming" && phase !== "done" && (
          <button
            className="btn"
            style={{ fontSize: 12 }}
            disabled={busy}
            onClick={handleResume}
          >
            Resume checking your last payment
          </button>
        )}

        {progress && phase !== "error" && phase !== "done" && (
          <p style={{ fontSize: 11, color: "#666", margin: 0 }}>{progress}</p>
        )}
        {phase === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: "VT323", fontSize: 20, color: "#006400" }}>
              {progress || "Payment confirmed — your ad is in review!"}
            </div>
            <button className="btn" style={{ fontSize: 12 }} onClick={resetCheckout}>
              Buy another ad
            </button>
          </div>
        )}
        {err && phase === "error" && (
          <div style={{ fontSize: 12, color: "#a00" }}>{err}</div>
        )}

        {/* Your ads */}
        <div style={{ borderTop: "1px solid #0002", paddingTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: "bold", color: "#333", margin: "0 0 6px" }}>
            Your ads
          </p>
          {myAds.isLoading ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>Loading…</p>
          ) : ads.length === 0 ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
              You haven't bought any ads yet.
            </p>
          ) : (
            <ul className="avp-list">
              {ads.map((ad) => {
                const ds = displayStatus(ad);
                return (
                  <li key={ad.id} className="avp-row">
                    <div className="avp-row-main">
                      <span className="avp-row-name">{ad.headline}</span>
                      <span className="avp-row-meta">
                        {ad.tagline}
                        {ad.days ? ` · ${ad.days} ${ad.days === 1 ? "day" : "days"}` : ""}
                        {ad.expiryAt && ds === "approved"
                          ? ` · until ${new Date(ad.expiryAt).toLocaleDateString()}`
                          : ""}
                      </span>
                    </div>
                    <div className="avp-row-actions">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: "bold",
                          color: STATUS_COLOR[ds],
                        }}
                      >
                        {STATUS_LABEL[ds]}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
