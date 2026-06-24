import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCryptoQuote,
  useVerifyCryptoPayment,
  useGetMe,
  getGetMeQueryKey,
  type CryptoCatalog,
  type CryptoOrderQuote,
  type LuckyBreakInfo,
  type LuckyBreakResult,
} from "@workspace/api-client-react";
import { computeDayPassPriceCents } from "../lib/dayPassPricing";
import { THEME_FELT, themeColorOf } from "../lib/backgroundVariants";
import ballImg from "/eightball_nobg.png";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LS_KEY = "breakbpm.crypto.pending";
/** ~3 min of polling at 4s intervals — comfortably covers Base confirmations. */
const MAX_POLLS = 45;
const POLL_MS = 4000;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

type Phase =
  | "idle"
  | "quoting"
  | "awaiting_payment"
  | "awaiting_signature"
  | "confirming"
  | "done"
  | "error";

interface Pending {
  orderId: string;
  /** Omitted for manual USDC orders, which the server auto-detects by amount. */
  txHash?: string;
  /**
   * The full manual quote, persisted so a refresh can restore the pay screen
   * (amount + address + QR, and the ETH tx-hash input). Without this, an ETH
   * payer who refreshes before pasting their hash would have no way to finish.
   */
  order?: CryptoOrderQuote;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Short, human duration blurb per pass kind (the catalog only ships name +
 * price, so we derive the sub-line here). */
const PASS_BLURB: Record<string, string> = {
  day: "Full access for 24 hours",
  month: "Full access for 30 days",
  year: "Full access for 365 days",
  lifetime: "Pay once, play forever",
};

function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const anyErr = e as { shortMessage?: string; message?: string };
    if (anyErr.shortMessage) return anyErr.shortMessage;
    if (anyErr.message) return anyErr.message;
  }
  return "Something went wrong.";
}

/**
 * EIP-681 payment URI — what the QR encodes. A mobile wallet scanning it
 * pre-fills the recipient + exact amount. USDC is an ERC-20 `transfer` call;
 * ETH is a native value send.
 */
function paymentUri(order: CryptoOrderQuote): string {
  if (order.asset === "eth") {
    return `ethereum:${order.receivingAddress}@${order.chainId}?value=${order.expectedAmount}`;
  }
  return `ethereum:${order.tokenAddress}@${order.chainId}/transfer?address=${order.receivingAddress}&uint256=${order.expectedAmount}`;
}

/** Numeric part of "1.23 USDC" — what we copy so it pastes cleanly as an amount. */
function amountValue(displayAmount: string): string {
  return displayAmount.split(" ")[0] ?? displayAmount;
}

export default function CryptoCheckout({
  catalog,
  hasAccess,
  luckyBreak,
  onLuckyBreakWin,
}: {
  catalog: CryptoCatalog;
  hasAccess: boolean;
  /** Disclosed Lucky Break odds, used to describe the on-chain Lucky Break item. */
  luckyBreak?: LuckyBreakInfo;
  /** Fired when a Lucky Break crypto payment is granted, so the parent can play
   * the "rolling the rack" reveal landing on the won tier. */
  onLuckyBreakWin?: (result: LuckyBreakResult) => void;
}) {
  const qc = useQueryClient();
  const createQuote = useCreateCryptoQuote();
  const verify = useVerifyCryptoPayment();

  // Pool-table felt skin follows the buyer's applied profile theme (same
  // derivation as StatsScreen): an explicit theme maps straight to its felt;
  // "auto"/"rainbow" fall back to the earned background; anything unrecognized
  // is green. Exposed as --n / --n-shadow on the panel for the felt-skinned
  // pass cards below.
  const meQuery = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const feltAccount = meQuery.data?.account;
  const feltRawTheme = feltAccount?.profileTheme ?? "none";
  const feltTheme =
    feltRawTheme === "auto" || feltRawTheme === "rainbow"
      ? (feltAccount?.profileBackground ?? "none")
      : feltRawTheme;
  const felt = THEME_FELT[themeColorOf(feltTheme)];

  const passes = catalog.passes;
  const dayPass = catalog.dayPass;
  // Default to the flexible "add days" pass — the primary crypto purchase. The
  // discrete Day/Month/Year cards are gone; Lucky Break + Lifetime remain as
  // fixed-price cards alongside the slider.
  const [passKind, setPassKind] =
    useState<CryptoOrderQuote["passKind"]>("days");
  const [days, setDays] = useState(7);
  const [asset, setAsset] = useState<CryptoOrderQuote["asset"]>("usdc");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  // The active manual (pay-to-address / QR) order awaiting payment.
  const [manualOrder, setManualOrder] = useState<CryptoOrderQuote | null>(null);
  const [txHashInput, setTxHashInput] = useState("");
  const [showHashInput, setShowHashInput] = useState(false);
  const [copied, setCopied] = useState("");

  // Keep the slider value inside the env-configured day-pass bounds so a custom
  // BREAKBPM_DAY_PASS_MIN/MAX_DAYS can't leave the label/request out of range
  // (otherwise the default of 7 could exceed a low maxDays and the quote would
  // reject it server-side).
  useEffect(() => {
    setDays((d) => Math.min(dayPass.maxDays, Math.max(dayPass.minDays, d)));
  }, [dayPass.minDays, dayPass.maxDays]);

  // Surface a resumable payment saved before a refresh / accidental close so a
  // user who already paid can finish verifying without re-sending funds.
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
      /* clipboard blocked — the value is still visible to copy by hand */
    }
  }

  const networkLabel =
    catalog.network === "base-sepolia" ? "Base Sepolia (testnet)" : "Base";

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
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        // A Lucky Break purchase lands on a won tier — hand the roll up so the
        // parent can play the reveal overlay.
        if (v.luckyBreak && onLuckyBreakWin) onLuckyBreakWin(v.luckyBreak);
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
      "Still confirming. Your pass will activate automatically once the transaction settles — check back shortly.",
    );
    setPhase("error");
  }

  // Primary flow: quote a manual order (no wallet binding) and show the
  // pay-to-address details + QR. Works on mobile and desktop, any wallet.
  async function handleGetDetails() {
    setErr("");
    setProgress("");
    setManualOrder(null);
    setTxHashInput("");
    setShowHashInput(false);
    setPhase("quoting");
    try {
      const q = await createQuote.mutateAsync({
        data:
          passKind === "days"
            ? { passKind: "days", days, asset }
            : { passKind, asset },
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

  // The user says they've paid → confirm. USDC with no pasted hash uses
  // server-side auto-detect (by the unique amount); ETH (and the paste-a-hash
  // fallback) confirm a specific transaction hash.
  async function handleConfirmManual(order: CryptoOrderQuote) {
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
    // Already have a settling tx (connected pay, or an ETH hash was pasted) —
    // resume polling straight away.
    if (pending.txHash) {
      await pollVerify(pending.orderId, pending.txHash);
      return;
    }
    // A manual order still awaiting payment: restore the full pay screen so a
    // USDC payer can re-trigger auto-detect and an ETH payer can paste their
    // hash (which a blind poll-without-hash couldn't accept).
    if (pending.order) {
      setManualOrder(pending.order);
      setProgress("");
      setTxHashInput("");
      setShowHashInput(false);
      setPhase("awaiting_payment");
      return;
    }
    // Legacy saved shape (no persisted order): best-effort USDC auto-detect.
    await pollVerify(pending.orderId);
  }

  const busy =
    phase === "quoting" ||
    phase === "awaiting_signature" ||
    phase === "confirming";
  const locked = busy || phase === "awaiting_payment";
  const showingOrder =
    !!manualOrder &&
    (phase === "awaiting_payment" || phase === "confirming");

  const isDaysSelected = passKind === "days";
  // Live estimate for the slider — the server recomputes + freezes the real
  // amount at quote time from the same shared formula.
  const daysPriceCents = computeDayPassPriceCents(days, dayPass);
  // Cheapest entry point, shown as the collapsed card's "From" price.
  const minDaysPriceCents = computeDayPassPriceCents(dayPass.minDays, dayPass);
  const selectedPass = passes.find((p) => p.passKind === passKind);
  const selectedPrice = isDaysSelected
    ? formatPrice(daysPriceCents)
    : selectedPass
      ? formatPrice(selectedPass.priceCents)
      : "";
  const isLuckyBreakSelected = passKind === "lucky_break";
  const oddsPct = luckyBreak
    ? Math.round(luckyBreak.lifetimeProbability * 100)
    : 20;
  const blurbFor = (kind: string): React.ReactNode =>
    kind === "lucky_break"
      ? (
        <>
          Pay once to get a Monthly pass — with a {oddsPct}% chance it upgrades
          to a Lifetime pass instead.
        </>
      )
      : (PASS_BLURB[kind] ?? "One-time pass");

  return (
    <div
      className="panel"
      style={{ "--n": felt.felt, "--n-shadow": felt.feltShadow } as React.CSSProperties}
    >
      <div className="panel-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true">⛓️</span>Pay with Crypto
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <p style={{ fontSize: 12, color: "#333", margin: 0 }}>
          Buy access with <strong>USDC</strong> or <strong>ETH</strong>{" "}
          on <strong>{networkLabel}</strong> — pick how many days you want, or go
          Lifetime. Pay from any wallet — scan the QR on mobile or copy the amount
          &amp; address on desktop. All sales final.
        </p>

        {hasAccess && (
          <div style={{ fontFamily: "VT323", fontSize: 18, color: "#006400" }}>You already have an active pass :)</div>
        )}

        {/* Pass picker — selectable cards. Locked once an order is quoted. The
           flexible "Purchase Days of Access" pass leads (its day slider is
           nested inside the card); Lucky Break + Lifetime follow as fixed-price
           cards. */}
        <div className="crypto-field">
          <span className="crypto-field-label">Choose a pass</span>
          <div className="crypto-options">
            <div
              className={`crypto-days${isDaysSelected ? " crypto-days--active" : ""}`}
            >
              <button
                type="button"
                className={`crypto-option crypto-days__head${isDaysSelected ? " crypto-option--active" : ""}`}
                disabled={locked}
                aria-pressed={isDaysSelected}
                onClick={() => setPassKind("days")}
              >
                <span className="crypto-option__radio" aria-hidden="true" />
                <span className="crypto-option__text">
                  <span className="crypto-option__name">
                    Purchase Days of Access
                  </span>
                  <span className="crypto-option__sub">
                    Any {dayPass.minDays}–{dayPass.maxDays} days · longer = less
                    per day
                  </span>
                </span>
                <span className="crypto-option__price">
                  {isDaysSelected
                    ? formatPrice(daysPriceCents)
                    : `from ${formatPrice(minDaysPriceCents)}`}
                </span>
              </button>
              {isDaysSelected && (
                <div className="crypto-days__config">
                  <div className="crypto-days__readout">
                    <span className="crypto-days__count">{days}</span>
                    <span className="crypto-days__unit">
                      {days === 1 ? "day" : "days"} of access
                    </span>
                  </div>
                  <input
                    className="crypto-days__slider"
                    type="range"
                    min={dayPass.minDays}
                    max={dayPass.maxDays}
                    value={days}
                    disabled={locked}
                    aria-label="Pass length in days"
                    style={{ "--ball-img": `url(${ballImg})` } as React.CSSProperties}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                  <div className="crypto-days__ends">
                    <span>{dayPass.minDays}</span>
                    <span>{dayPass.maxDays}</span>
                  </div>
                  <span className="crypto-days__note">
                    Final price locks in when you get your quote
                  </span>
                </div>
              )}
            </div>
            {passes.map((p) => {
              const active = passKind === p.passKind;
              return (
                <button
                  key={p.passKind}
                  type="button"
                  className={`crypto-option${active ? " crypto-option--active" : ""}`}
                  disabled={locked}
                  aria-pressed={active}
                  onClick={() => setPassKind(p.passKind)}
                >
                  <span className="crypto-option__radio" aria-hidden="true" />
                  <span className="crypto-option__text">
                    <span className="crypto-option__name">
                      {p.passKind === "lifetime" ? (
                        <span className="rainbow-name">{p.name}</span>
                      ) : (
                        p.name
                      )}
                    </span>
                    <span className="crypto-option__sub">
                      {blurbFor(p.passKind)}
                    </span>
                  </span>
                  <span className="crypto-option__price">
                    {formatPrice(p.priceCents)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Asset toggle — split control */}
        <div className="crypto-field">
          <span className="crypto-field-label">Pay with</span>
          <div className="crypto-assets">
            {catalog.assets.map((a) => (
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

        {showingOrder && manualOrder ? (
          /* ---- Manual order: pay-to-address details + QR ---- */
          (<div className="crypto-pay">
            <p style={{ fontSize: 12, color: "#333", margin: 0 }}>
              Send <strong>exactly</strong> this amount
              {manualOrder.passKind === "days" && manualOrder.days ? (
                <>
                  {" "}
                  for a <strong>{manualOrder.days}-day</strong> pass
                </>
              ) : null}{" "}
              to the address below. The exact amount is how we match your payment
              — sending a different amount won't confirm.
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
            {/* On a phone, an EIP-681 ethereum: link lets the OS hand off to any
               installed wallet app (the recipient + exact amount pre-filled) —
               this is the no-WalletConnect way to "pick your wallet app".
               target="_top" breaks out of the workspace preview iframe so the
               custom scheme reaches the OS; on a real phone it opens the wallet
               chooser. It's a no-op on desktop (no wallet handler registered). */}
            <a
              className="btn btn-big crypto-walletlink"
              href={paymentUri(manualOrder)}
              target="_top"
              rel="noopener noreferrer"
              aria-label="Open payment request in an installed wallet app"
            >
              <span aria-hidden="true">📱 </span>Open in wallet app
            </a>
            <span style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
              Tap on your phone — opens an installed wallet app (MetaMask,
              Coinbase Wallet, Rabby…). May not work on desktop; use the QR or
              copy flow there.
            </span>
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
          </div>)
        ) : phase !== "done" ? (
          /* ---- Pre-payment: Lucky Break info (when selected) + pay button ---- */
          (<>
            {isLuckyBreakSelected && (
              <div
                className="notice"
                style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}
              >
                <span style={{ fontWeight: "bold", fontSize: 12 }}>
                  🎱 Lucky Break — Roll the Rack
                </span>
                <span style={{ fontSize: 11 }}>
                  A guaranteed upgrade: win at minimum a 30-day Monthly Pass, with
                  a {oddsPct}% chance it's a Lifetime Pass instead. The outcome is a
                  provably-fair seeded draw, decided the moment your payment
                  confirms.
                </span>
              </div>
            )}
            <button
              className="btn btn-primary btn-big"
              disabled={busy}
              onClick={handleGetDetails}
            >
              {phase === "quoting"
                ? "Getting a quote…"
                : isLuckyBreakSelected
                  ? `Roll the Rack — ${selectedPrice} with ${asset.toUpperCase()}`
                  : isDaysSelected
                    ? `Pay ${selectedPrice} for ${days} ${days === 1 ? "day" : "days"} with ${asset.toUpperCase()}`
                    : `Pay ${selectedPrice} with ${asset.toUpperCase()}`}
            </button>
          </>)
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
          <div style={{ fontFamily: "VT323", fontSize: 20, color: "#006400" }}>
            {progress || "Payment confirmed — your pass is active!"}
          </div>
        )}
        {err && phase === "error" && (
          <div style={{ fontSize: 12, color: "#a00" }}>{err}</div>
        )}
      </div>
    </div>
  );
}
