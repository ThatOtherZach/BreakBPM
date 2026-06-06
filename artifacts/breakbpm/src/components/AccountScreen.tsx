import { useState, useEffect } from "react";
import { useAuth, signInPath } from "../lib/authClient";
import {
  useGetMe,
  useUpdateScreenName,
  useGetGameHistory,
  useCancelSubscription,
  useListMyGiftCodes,
  useGenerateGiftCode,
  useRedeemDiscountCode,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
  getListMyGiftCodesQueryKey,
  type LuckyBreakResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import GameHistoryCard, { fmtDate } from "./GameHistoryCard";
import LuckyBreakReveal from "./LuckyBreakReveal";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The rack tumbles for at least this long so a seeded Lucky Break draw always
// feels like a genuine roll, even when the server responds instantly.
const MIN_ROLL_MS = 2200;

type RevealState = "idle" | "rolling" | "result";

interface Props {
  onBack: () => void;
  onPasses: () => void;
  onAbout: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
}

/**
 * Hours-rounded countdown used by the "Gift a Day Pass" section. The spec
 * intentionally shows whole hours only (any sub-hour remainder rounds UP)
 * so the cooldown label is calm and predictable.
 */
function fmtHoursUntil(target: Date | string | null): string | null {
  if (!target) return null;
  const ms = (target instanceof Date ? target : new Date(target)).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 1) return null;
  return `~${hours}h`;
}

export default function AccountScreen({ onBack, onPasses, onAbout, onFindPlayers, onSignIn }: Props) {
  const { logout: signOut } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [cancelMsg, setCancelMsg] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [giftMsg, setGiftMsg] = useState("");
  const [giftCopied, setGiftCopied] = useState(false);
  const [code, setCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState("");
  const [revealState, setRevealState] = useState<RevealState>("idle");
  const [revealResult, setRevealResult] = useState<LuckyBreakResult | null>(null);
  // Force a re-render every 5 minutes so the cooldown / "expires in ~Xh"
  // labels in the gift panel drift naturally without spamming setInterval.
  const [, setClockTick] = useState(0);

  const me = useGetMe();
  const history = useGetGameHistory({ page: historyPage });
  const updateName = useUpdateScreenName();
  const cancelSub = useCancelSubscription();
  const myGiftCodes = useListMyGiftCodes();
  const generateGift = useGenerateGiftCode();
  const redeem = useRedeemDiscountCode();

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (me.data?.account?.screenName) setName(me.data.account.screenName);
  }, [me.data?.account?.screenName]);

  if (me.isLoading) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} onAbout={onAbout} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
        <div className="app-body">
          <p style={{ fontFamily: "VT323", fontSize: 18 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!me.data?.signedIn) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} onAbout={onAbout} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
        <div className="app-body">
          <div className="panel">
            <div className="panel-header"><span>Account</span></div>
            <div className="panel-body">
              <p style={{ fontSize: 13, marginBottom: 10 }}>You're not signed in.</p>
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

  const account = me.data.account!;
  const ent = me.data.entitlement;
  const passes = me.data.passes ?? [];
  const canEditName = passes.some((p) => p.isLifetime);

  async function handleSaveName() {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) { setError("Screen name required"); return; }
    try {
      await updateName.mutateAsync({ data: { screenName: trimmed } });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditing(false);
    } catch (e) {
      // The server returns a specific reason (name taken / invalid format)
      // in the response body — surface that rather than a generic message.
      const serverError = (e as { data?: { error?: string } })?.data?.error;
      setError(serverError ?? (e instanceof Error ? e.message : "Update failed"));
    }
  }

  async function handleGenerateGift() {
    setGiftMsg("");
    setGiftCopied(false);
    try {
      const result = await generateGift.mutateAsync();
      setGiftMsg(result.message);
      qc.invalidateQueries({ queryKey: getListMyGiftCodesQueryKey() });
    } catch (e) {
      setGiftMsg(e instanceof Error ? e.message : "Generate failed");
    }
  }

  async function handleCopyGift(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setGiftCopied(true);
      // Drop the "Copied" flash after 2s; harmless if the user navigates away.
      setTimeout(() => setGiftCopied(false), 2000);
    } catch {
      // Some sandboxed iframes block clipboard writes — surface that gently.
      setGiftMsg("Couldn't copy automatically — long-press to copy manually.");
    }
  }

  /**
   * Redeem a code. Lucky Break codes resolve to a server-seeded roll, so we
   * play the "rolling the rack" overlay for suspense, enforce a minimum roll
   * duration, then reveal the won tier. Plain codes (e.g. gifted Day/Year/
   * Lifetime passes) skip the animation and just surface their message.
   */
  async function handleRedeem() {
    setRedeemMsg("");
    const trimmed = code.trim();
    if (!trimmed) return;

    setRevealResult(null);

    try {
      const result = await redeem.mutateAsync({ data: { code: trimmed } });

      if (result.success) {
        setCode("");
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
      }

      if (result.luckyBreak) {
        // Lucky Break code → tumble the rack for a beat, then land on the
        // server-decided tier. Plain gift codes skip the overlay entirely.
        setRevealState("rolling");
        await delay(MIN_ROLL_MS);
        setRevealResult(result.luckyBreak);
        setRevealState("result");
        setRedeemMsg(result.message);
      } else {
        setRedeemMsg(result.message);
      }
    } catch (e) {
      setRevealState("idle");
      setRedeemMsg(e instanceof Error ? e.message : "Redeem failed");
    }
  }

  async function handleCancelSub() {
    setCancelMsg("");
    try {
      const result = await cancelSub.mutateAsync();
      setCancelMsg(result.message);
      if (result.success) qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setCancelMsg(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function handleSignOut() {
    await signOut();
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
    onBack();
  }

  const sub = ent.activeSubscription;
  const tierLabel =
    ent.tier === "pass"
      ? ent.activePass?.kind === "lifetime" ? "Lifetime Pass ★"
        : sub ? (sub.interval === "month" ? "Monthly ★" : "Yearly ★")
        : ent.activePass?.kind === "year" ? "Year Pass ★"
        : ent.activePass?.kind === "day" ? "Day Pass ★"
        : "Pass Holder ★"
    : ent.tier === "account" ? "Free Account"
    : "Public";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
      <div className="app-body">

        {/* Identity panel */}
        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>👤</span>Identity</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {editing ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="btn btn-primary" disabled={updateName.isPending} onClick={handleSaveName}>Save</button>
                <button className="btn" onClick={() => { setEditing(false); setName(account.screenName); }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontFamily: "VT323", fontSize: 22, color: "#000080" }}>{account.screenName}</span>
                {canEditName && (
                  <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}>Edit</button>
                )}
              </div>
            )}
            {!editing && (
              <div style={{ fontSize: 11, color: "#444", marginTop: 1 }}>
                📺{" "}
                <a
                  href={`/watch/${encodeURIComponent(account.screenName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#000080" }}
                >
                  breakbpm.com/watch/{account.screenName}
                </a>
              </div>
            )}
            {!canEditName && !editing && (
              <div style={{ fontSize: 11, color: "#444" }}>
                <button
                  className="link-btn"
                  onClick={onPasses}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#000080",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "inherit",
                  }}
                >
                  Get a pass
                </button>
                {" to unlock more — custom screen names come with Lifetime."}
              </div>
            )}
            {error && <div style={{ color: "#c00", fontSize: 12 }}>{error}</div>}
            {account.email && (
              <div style={{ fontSize: 11, color: "#444" }}>
                EMAIL — <span style={{ color: "#000" }}>{account.email}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tier panel */}
        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎖️</span>Tier</span></div>
          <div className="panel-body">
            <div style={{ fontFamily: "VT323", fontSize: 24, color: ent.tier === "pass" ? "#006400" : "#000080" }}>
              {tierLabel}
            </div>
            {ent.activePass && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {ent.activePass.isLifetime
                  ? "Never Expires :)"
                  : `Expires ${fmtDate(ent.activePass.expiresAt)}`}
              </div>
            )}
            {passes.length > 1 && (
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>
                {passes.length} active passes (stacked)
              </div>
            )}
            {sub && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <div style={{ color: sub.cancelAtPeriodEnd ? "#8a6d00" : "#006400" }}>
                  {sub.cancelAtPeriodEnd
                    ? `↛ Cancels ${fmtDate(sub.currentPeriodEnd)} — access until then`
                    : `↻ Renews ${fmtDate(sub.currentPeriodEnd)}`}
                </div>
                {!sub.cancelAtPeriodEnd && (
                  <button
                    className="btn w-full"
                    style={{ marginTop: 8 }}
                    disabled={cancelSub.isPending}
                    onClick={handleCancelSub}
                  >
                    {cancelSub.isPending ? "Cancelling…" : "Cancel Subscription"}
                  </button>
                )}
                {cancelMsg && (
                  <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>{cancelMsg}</div>
                )}
              </div>
            )}
            {!ent.activePass?.isLifetime && (
              <button className="btn btn-primary w-full" style={{ marginTop: 10 }} onClick={onPasses}>
                {ent.tier === "pass" ? "Manage Passes" : "Get a Pass"}
              </button>
            )}
            {/* Gift a Day Pass — Year and Lifetime holders can mint a single
                24h Day-Pass gift code, once every 12h. Cooldown is computed
                server-side from the most recent generation time, so the
                client just renders whichever state the API returns. */}
            {ent.activePass &&
              (ent.activePass.kind === "year" || ent.activePass.isLifetime) &&
              myGiftCodes.data?.eligible && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid #ccc",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "VT323",
                      fontSize: 18,
                      marginBottom: 4,
                    }}
                  >
                    Gift a Day Pass
                  </div>
                  <p style={{ fontSize: 11, color: "#444", marginBottom: 6 }}>
                    Share a 24-hour pass with a friend. One use per code, one
                    new code every 12 hours.
                  </p>
                  {(() => {
                    const latest = myGiftCodes.data.codes[0];
                    const cooldownActive = myGiftCodes.data.cooldownActive;
                    const nextLabel = fmtHoursUntil(
                      myGiftCodes.data.nextAvailableAt ?? null,
                    );
                    // `fmtHoursUntil` returns null for sub-hour remainders,
                    // which we render as "Available soon" — never the awkward
                    // "Available in ~Xh" with a missing value.
                    const cooldownLabel = nextLabel
                      ? `Available in ${nextLabel}`
                      : "Available soon";
                    return (
                      <>
                        <button
                          className="btn btn-primary w-full"
                          disabled={generateGift.isPending || cooldownActive}
                          onClick={handleGenerateGift}
                        >
                          {cooldownActive
                            ? cooldownLabel
                            : generateGift.isPending
                              ? "Generating…"
                              : latest
                                ? "Generate New Code"
                                : "Generate Gift Code"}
                        </button>
                        {latest && !latest.expired && (
                          <div style={{ marginTop: 8 }}>
                            <div
                              style={{
                                fontFamily: "monospace",
                                fontSize: 16,
                                padding: "6px 8px",
                                background: "#f5f5dc",
                                border: "1px solid #999",
                                wordBreak: "break-all",
                              }}
                            >
                              {latest.code}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginTop: 4,
                                gap: 8,
                              }}
                            >
                              <span style={{ fontSize: 11, color: "#444" }}>
                                {(() => {
                                  if (latest.redeemed) return "Redeemed";
                                  if (latest.expired) return "Expired";
                                  const h = fmtHoursUntil(latest.expiresAt);
                                  return h
                                    ? `Unused — expires in ${h}`
                                    : "Unused — expires soon";
                                })()}
                              </span>
                              <button
                                className="btn"
                                onClick={() => handleCopyGift(latest.code)}
                              >
                                {giftCopied ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {giftMsg && (
                    <div className="notice" style={{ marginTop: 8 }}>
                      <span>ℹ</span>
                      <span>{giftMsg}</span>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>

        {/* Redeem a Code panel — handles both Lucky Break roll codes (animated
            reveal) and plain gifted Day/Year/Lifetime codes (plain message). */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎟️</span>Redeem a Code
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>Have gift code? Enter it here to unlock.</p>
            <input
              className="input"
              placeholder="ENTER CODE"
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={redeem.isPending || revealState !== "idle"}
            />
            <button
              className="btn btn-primary btn-big w-full"
              disabled={redeem.isPending || revealState !== "idle" || !code.trim()}
              onClick={handleRedeem}
            >
              {redeem.isPending || revealState === "rolling" ? "Redeeming…" : "Redeem"}
            </button>
            {redeemMsg && revealState !== "result" && (
              <div className="notice">
                <span>ℹ</span>
                <span>{redeemMsg}</span>
              </div>
            )}
          </div>
        </div>

        {/* History panel */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>📜</span>Recent Games
              {history.data && history.data.totalPages > 1
                ? ` — Page ${history.data.page}/${history.data.totalPages}`
                : history.data
                ? ` (${history.data.visibleCount}/${history.data.totalCount})`
                : ""}
            </span>
          </div>
          <div className="panel-body">
            {history.isLoading && <p style={{ fontSize: 12 }}>Loading…</p>}
            {history.data && history.data.games.length === 0 && (
              <p style={{ fontSize: 12, color: "#444" }}>No games saved yet. Play one!</p>
            )}
            {history.data?.games.map((g) => (
              <GameHistoryCard key={g.id} game={g} />
            ))}

            {/* Pass holder pagination controls — shown for any pass holder,
                with Prev/Next disabled at boundaries */}
            {history.data && ent.hasActivePass && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={history.data.page <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#444" }}>
                  {history.data.page} / {history.data.totalPages}
                </span>
                <button
                  className="btn"
                  disabled={history.data.page >= history.data.totalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}

            {/* Free-tier upgrade CTA */}
            {history.data?.truncated && (
              <button
                className="btn w-full"
                style={{
                  marginTop: 10,
                  textAlign: "left",
                  fontSize: 12,
                  color: "#000080",
                  background: "#f0f0f0",
                  border: "1px solid #aaa",
                  padding: "6px 8px",
                  cursor: "pointer",
                }}
                onClick={onPasses}
              >
                💡 Showing your {history.data.visibleCount} most recent games. Upgrade to see all {history.data.totalCount} →
              </button>
            )}
          </div>
        </div>

        <button
          className="btn btn-big w-full"
          style={{ marginTop: 8, marginBottom: 16 }}
          onClick={handleSignOut}
        >
          Sign Out
        </button>
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
