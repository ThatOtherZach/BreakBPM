import { useState, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useSendTransaction,
  useWriteContract,
  useSignMessage,
} from "wagmi";
import { erc20Abi } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCryptoQuote,
  useVerifyCryptoPayment,
  getGetMeQueryKey,
  type CryptoCatalog,
  type CryptoOrderQuote,
  type LuckyBreakInfo,
  type LuckyBreakResult,
} from "@workspace/api-client-react";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LS_KEY = "breakbpm.crypto.pending";
/** ~3 min of polling at 4s intervals — comfortably covers Base confirmations. */
const MAX_POLLS = 45;
const POLL_MS = 4000;

type Phase =
  | "idle"
  | "quoting"
  | "awaiting_signature"
  | "confirming"
  | "done"
  | "error";

interface Pending {
  orderId: string;
  txHash: string;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
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

// MUST match buildCheckoutMessage in api-server/src/lib/cryptoChain.ts exactly —
// the server recovers the signer from this string to prove wallet ownership.
function buildCheckoutMessage(p: {
  payerAddress: string;
  passKind: string;
  asset: string;
  issuedAt: number;
}): string {
  return [
    "BreakBPM crypto checkout",
    "Authorize this wallet to pay for a pass.",
    `Wallet: ${p.payerAddress}`,
    `Pass: ${p.passKind}`,
    `Asset: ${p.asset}`,
    `Issued: ${p.issuedAt}`,
  ].join("\n");
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
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const createQuote = useCreateCryptoQuote();
  const verify = useVerifyCryptoPayment();

  const passes = catalog.passes;
  const [passKind, setPassKind] = useState<CryptoOrderQuote["passKind"]>(
    passes[0]?.passKind ?? "day",
  );
  const [asset, setAsset] = useState<CryptoOrderQuote["asset"]>("usdc");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

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

  const networkLabel =
    catalog.network === "base-sepolia" ? "Base Sepolia (testnet)" : "Base";
  const wrongChain = isConnected && chainId !== catalog.chainId;

  async function pollVerify(orderId: string, txHash: string) {
    setPhase("confirming");
    for (let i = 0; i < MAX_POLLS; i++) {
      let v;
      try {
        v = await verify.mutateAsync({ data: { orderId, txHash } });
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
      // pending / not_found → keep waiting
      setProgress(v.message);
      await delay(POLL_MS);
    }
    setErr(
      "Still confirming. Your pass will activate automatically once the transaction settles — check back shortly.",
    );
    setPhase("error");
  }

  async function handlePay() {
    setErr("");
    setProgress("");
    setPhase("quoting");
    try {
      if (chainId !== catalog.chainId) {
        await switchChainAsync({ chainId: catalog.chainId });
      }
      if (!address) throw new Error("Connect a wallet first.");

      // Prove wallet ownership so the server can bind the quote to this payer
      // (blocks claiming someone else's public on-chain payment).
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({
        account: address,
        message: buildCheckoutMessage({
          payerAddress: address,
          passKind,
          asset,
          issuedAt,
        }),
      });

      const q = await createQuote.mutateAsync({
        data: { passKind, asset, payerAddress: address, signature, issuedAt },
      });
      if (!q.success || !q.order) {
        setErr(q.message);
        setPhase("error");
        return;
      }
      const order = q.order;

      setPhase("awaiting_signature");
      setProgress(`Confirm sending ${order.displayAmount} in your wallet…`);

      let txHash: string;
      if (order.asset === "eth") {
        txHash = await sendTransactionAsync({
          to: order.receivingAddress as `0x${string}`,
          value: BigInt(order.expectedAmount),
          chainId: catalog.chainId,
        });
      } else {
        if (!order.tokenAddress) throw new Error("Missing token address.");
        txHash = await writeContractAsync({
          address: order.tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [
            order.receivingAddress as `0x${string}`,
            BigInt(order.expectedAmount),
          ],
          chainId: catalog.chainId,
        });
      }

      savePending({ orderId: order.id, txHash });
      await pollVerify(order.id, txHash);
    } catch (e) {
      setErr(errText(e));
      setPhase("error");
    }
  }

  async function handleResume() {
    if (!pending) return;
    setErr("");
    await pollVerify(pending.orderId, pending.txHash);
  }

  const busy =
    phase === "quoting" ||
    phase === "awaiting_signature" ||
    phase === "confirming";

  const selectedPass = passes.find((p) => p.passKind === passKind);
  const selectedPrice = selectedPass ? formatPrice(selectedPass.priceCents) : "";
  const isLuckyBreakSelected = passKind === "lucky_break";
  const oddsPct = luckyBreak
    ? Math.round(luckyBreak.lifetimeProbability * 100)
    : 20;
  const blurbFor = (kind: string): string =>
    kind === "lucky_break"
      ? `Guaranteed Monthly · ${oddsPct}% shot at Lifetime`
      : (PASS_BLURB[kind] ?? "One-time pass");

  return (
    <div className="panel">
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
          Buy a one-time pass with <strong>USDC</strong> or <strong>ETH</strong>{" "}
          on <strong>{networkLabel}</strong>. Self-custody — pay from your own
          wallet, no account needed. All sales final.
        </p>

        {hasAccess && (
          <div style={{ fontFamily: "VT323", fontSize: 18, color: "#006400" }}>
            You already have active access — no need to buy another pass.
          </div>
        )}

        {/* Wallet connection */}
        {!isConnected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {connectors.map((c) => (
              <button
                key={c.uid}
                className="btn btn-primary"
                disabled={connecting}
                onClick={() => connect({ connector: c })}
              >
                Connect {c.name}
              </button>
            ))}
            {connectors.length === 0 && (
              <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
                No wallet detected. Install a browser wallet to continue.
              </p>
            )}
          </div>
        ) : (
          <div className="crypto-wallet">
            <span className="crypto-wallet__addr">
              <span className="crypto-wallet__dot" aria-hidden="true" />
              Connected · <strong>{address ? shortAddr(address) : ""}</strong>
            </span>
            <button
              className="btn"
              style={{ fontSize: 11, minHeight: 28 }}
              onClick={() => disconnect()}
              disabled={busy}
            >
              Disconnect
            </button>
          </div>
        )}

        {wrongChain && (
          <div style={{ fontSize: 11, color: "#a00" }}>
            Wrong network selected — we'll switch you to {networkLabel} when you
            pay.
          </div>
        )}

        {/* Pass picker — selectable cards. Always visible so anyone can browse
            the passes and prices (matching the card flow); sending payment
            still requires a connected wallet. */}
        <div className="crypto-field">
          <span className="crypto-field-label">Choose a pass</span>
          <div className="crypto-options">
            {passes.map((p) => {
              const active = passKind === p.passKind;
              return (
                <button
                  key={p.passKind}
                  type="button"
                  className={`crypto-option${active ? " crypto-option--active" : ""}`}
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => setPassKind(p.passKind)}
                >
                  <span className="crypto-option__radio" aria-hidden="true" />
                  <span className="crypto-option__text">
                    <span className="crypto-option__name">{p.name}</span>
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
                disabled={busy}
                aria-pressed={asset === a}
                onClick={() => setAsset(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {isConnected ? (
          <button
            className="btn btn-primary btn-big"
            disabled={busy}
            onClick={handlePay}
          >
            {phase === "quoting"
              ? "Getting a quote…"
              : phase === "awaiting_signature"
                ? "Confirm in wallet…"
                : phase === "confirming"
                  ? "Confirming on-chain…"
                  : isLuckyBreakSelected
                    ? `Roll the Rack — ${selectedPrice} with ${asset.toUpperCase()}`
                    : `Pay ${selectedPrice} with ${asset.toUpperCase()}`}
          </button>
        ) : (
          <p style={{ fontSize: 11, color: "#888", margin: 0 }}>
            Connect a wallet above to pay with {asset.toUpperCase()}.
          </p>
        )}

        {/* Resume an interrupted payment */}
        {pending && phase !== "confirming" && phase !== "done" && (
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
