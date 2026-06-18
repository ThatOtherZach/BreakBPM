import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { useAuth, signInPath } from "../lib/authClient";
import {
  loadCardBackground,
  ensureCardFonts,
  drawRedeemCard,
  downloadCanvas,
  redeemUrlFor,
  cardFilename,
} from "../lib/redeemCard";
import type { BackgroundVariant } from "../lib/backgroundVariants";
import { THEME_DOT, THEME_FELT, themeColorOf } from "../lib/backgroundVariants";
import {
  useGetMe,
  useUpdateScreenName,
  useUpdateProfileTheme,
  useGetGameHistory,
  useCancelSubscription,
  useListMyGiftCodes,
  useGenerateGiftCode,
  useRedeemDiscountCode,
  useListAdminDiscountCodes,
  useCreateAdminDiscountCode,
  useListMyInvites,
  useAcceptInvite,
  useRemoveInvite,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
  getListMyGiftCodesQueryKey,
  getListAdminDiscountCodesQueryKey,
  getListMyInvitesQueryKey,
  type LuckyBreakResult,
  type AdminCodeInputKind,
  type AccountProfileTheme,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import GameHistoryCard, { fmtDate } from "./GameHistoryCard";
import LuckyBreakReveal from "./LuckyBreakReveal";
import AdminSalesPanel from "./AdminSalesPanel";
import AdminVenuesPanel from "./AdminVenuesPanel";
import { WinsTodayChip } from "./WinsTodayChip";

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
  onStats: () => void;
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

export default function AccountScreen({ onBack, onPasses, onAbout, onFindPlayers, onStats, onSignIn }: Props) {
  const { logout: signOut } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

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
  const [adminKind, setAdminKind] = useState<AdminCodeInputKind>("day");
  const [adminUses, setAdminUses] = useState("1");
  const [adminUnlimited, setAdminUnlimited] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");
  const [adminCopied, setAdminCopied] = useState("");
  // Branded redeem-card image generator. `card` holds the code+tier currently
  // rendered onto the preview canvas.
  // One flow: when on, a freshly minted code downloads its branded card AND
  // carries splash artwork (stored on the code; the recipient's watch profile +
  // the card both wear it). Off → no card download and no artwork assigned.
  const [autoDownloadCard, setAutoDownloadCard] = useState(true);
  const [card, setCard] = useState<{
    code: string;
    kind: string;
    variant: BackgroundVariant | null;
  } | null>(null);
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Set true right before `card` changes when the resulting render should also
  // download; the draw effect consumes (and clears) it after compositing.
  const pendingCardDownloadRef = useRef(false);
  // Force a re-render every 5 minutes so the cooldown / "expires in ~Xh"
  // labels in the gift panel drift naturally without spamming setInterval.
  const [, setClockTick] = useState(0);

  const me = useGetMe();
  const history = useGetGameHistory({ page: historyPage });
  const updateName = useUpdateScreenName();
  const updateTheme = useUpdateProfileTheme();
  const cancelSub = useCancelSubscription();
  const myGiftCodes = useListMyGiftCodes();
  const generateGift = useGenerateGiftCode();
  const redeem = useRedeemDiscountCode();
  // Admin-only: the generator + recent-codes list. The list query is gated on
  // `me.data.entitlement.isAdmin` so non-admins never even fire the request
  // (the server 403s regardless).
  const isAdmin = me.data?.signedIn ? me.data.entitlement.isAdmin : false;
  const adminCodes = useListAdminDiscountCodes({
    query: { queryKey: getListAdminDiscountCodesQueryKey(), enabled: isAdmin },
  });
  const createAdminCode = useCreateAdminDiscountCode();

  // @Mention invites: games where another paid host linked the caller by
  // screen name. Pending invites are opt-in (Accept counts the game toward
  // the caller's stats/history; Delete removes it and it never counts).
  // Accepted invites stay listed so the caller can later remove the game
  // (anonymizes their slot; the host's copy is untouched).
  const invites = useListMyInvites({
    query: { queryKey: getListMyInvitesQueryKey(), enabled: me.data?.signedIn === true },
  });
  const acceptInvite = useAcceptInvite();
  const removeInvite = useRemoveInvite();
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  async function refetchInviteSideEffects() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListMyInvitesQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() }),
    ]);
  }

  async function handleAcceptInvite(id: string) {
    setInviteMsg("");
    setInviteBusyId(id);
    try {
      const res = await acceptInvite.mutateAsync({ id });
      if (!res.accepted) {
        setInviteMsg(res.reason === "slot_unavailable" ? "That slot is no longer available." : "Could not accept invite.");
      }
      await refetchInviteSideEffects();
    } catch {
      setInviteMsg("Could not accept invite. Please try again.");
    } finally {
      setInviteBusyId(null);
    }
  }

  async function handleRemoveInvite(id: string) {
    setInviteMsg("");
    setInviteBusyId(id);
    try {
      await removeInvite.mutateAsync({ id });
      await refetchInviteSideEffects();
    } catch {
      setInviteMsg("Could not update invite. Please try again.");
    } finally {
      setInviteBusyId(null);
    }
  }

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (me.data?.account?.screenName) setName(me.data.account.screenName);
  }, [me.data?.account?.screenName]);

  // Composite the card whenever `card` changes: shark background + QR + brand.
  // The hidden <QRCodeCanvas> paints in its own (child) effect before this one,
  // and awaiting the image/fonts guarantees the QR is ready by the time we draw.
  // Must stay above the early returns below so hook order is stable.
  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    (async () => {
      try {
        const [img] = await Promise.all([loadCardBackground(card.variant), ensureCardFonts()]);
        if (cancelled) return;
        const out = cardCanvasRef.current;
        const qr = qrCanvasRef.current;
        if (!out || !qr) return;
        drawRedeemCard(out, {
          code: card.code,
          kind: card.kind,
          bgImg: img,
          qrCanvas: qr,
        });
        if (pendingCardDownloadRef.current) {
          pendingCardDownloadRef.current = false;
          downloadCanvas(out, cardFilename(card.code));
        }
      } catch {
        setAdminMsg("Couldn't build the card image.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card]);

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
  // Custom screen names are a Lifetime perk; admins are effective Lifetime
  // holders, so honor the synthesized entitlement (mirrors the server gate).
  const canEditName = ent.isAdmin || ent.activePass?.isLifetime === true;
  // The caller's own all-time global BPM standing, so the Identity card can
  // read like a leaderboard row (felt tint + global rank). Null until they have
  // enough qualifying ranked games to appear in the leaderboard.
  const standing = me.data.globalStanding ?? null;
  const identityFelt = THEME_FELT[themeColorOf(account.profileBackground)];
  // Theme cycle for the identity card toggle button (same order as the old select).
  const THEME_CYCLE = ["shark", "pool-player", "hustler", "none"] as const;
  const effectiveTheme = (account.profileTheme === "auto"
    ? (account.profileBackground ?? "none")
    : account.profileTheme) as AccountProfileTheme;

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

  async function handleChangeTheme(theme: AccountProfileTheme) {
    try {
      await updateTheme.mutateAsync({ data: { profileTheme: theme } });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch {
      // Non-fatal: the select snaps back to the server value on the next
      // me refetch, so a failed save simply leaves the old theme in place.
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

  async function handleCreateAdminCode() {
    setAdminMsg("");
    let maxRedemptions: number | null = null;
    if (!adminUnlimited) {
      const n = Number.parseInt(adminUses, 10);
      if (!Number.isInteger(n) || n < 1) {
        setAdminMsg("Uses must be a whole number ≥ 1 (or pick Unlimited).");
        return;
      }
      maxRedemptions = n;
    }
    try {
      const res = await createAdminCode.mutateAsync({
        // One flow: opting into the branded card download also stores its
        // artwork on the code, so the buyer's card and watch profile match.
        data: { kind: adminKind, maxRedemptions, includeArtwork: autoDownloadCard },
      });
      qc.invalidateQueries({ queryKey: getListAdminDiscountCodesQueryKey() });
      // Render the shareable card for the freshly minted code; auto-download
      // it when the admin opted in (their main use case — emailing the buyer).
      // The artwork is whatever the server stored on the code.
      pendingCardDownloadRef.current = autoDownloadCard;
      setCard({
        code: res.code.code,
        kind: res.code.grantsPassKind,
        variant: res.code.backgroundVariant ?? null,
      });
    } catch (e) {
      setAdminMsg(e instanceof Error ? e.message : "Could not create code.");
    }
  }

  // Build (and download) the card for any existing code from the Recent Codes
  // list. An explicit click always downloads, regardless of the checkbox. The
  // artwork is whatever was stored on the code when it was minted.
  function handleMakeCard(
    code: string,
    kind: string,
    variant: BackgroundVariant | null,
  ) {
    setAdminMsg("");
    pendingCardDownloadRef.current = true;
    setCard({ code, kind, variant });
  }

  async function handleCopyAdmin(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setAdminCopied(code);
      setTimeout(() => setAdminCopied(""), 2000);
    } catch {
      setAdminMsg("Couldn't copy automatically — long-press to copy manually.");
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
      <Navbar
        onBack={onBack}
        onAbout={onAbout}
        onStats={ent.tier === "pass" ? onStats : undefined}
        onFindPlayers={ent.tier === "pass" ? onFindPlayers : undefined}
        onSignIn={onSignIn}
      />
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
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="btn btn-primary" disabled={updateName.isPending} onClick={handleSaveName}>Save</button>
                <button className="btn" onClick={() => { setEditing(false); setName(account.screenName); }}>Cancel</button>
              </div>
            ) : (
              <>
                {/* Styled like a leaderboard standing (fpp-card history-card):
                    felt tinted to the player's theme, global rank on the left,
                    name in the middle, and the player's all-time BPM/accuracy
                    hero on the right. */}
                <div
                  className="fpp-card history-card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: identityFelt.felt,
                    boxShadow: `inset 0 0 0 2px ${identityFelt.feltShadow}, inset 0 2px 6px rgba(0, 0, 0, 0.35)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "VT323",
                      fontSize: 20,
                      lineHeight: 1,
                      color: "#ffe98a",
                      textShadow: "1px 1px 0 #042414",
                      minWidth: 44,
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                    title={
                      standing
                        ? `Global rank #${standing.rank}`
                        : "Play ranked 8-ball 1-on-1 games to earn a global rank"
                    }
                  >
                    {standing ? `🌎#${standing.rank}` : "🌎—"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                      <span
                        style={{
                          fontFamily: "VT323",
                          fontSize: 22,
                          lineHeight: 1,
                          color: "#f4f4dc",
                          textShadow: "1px 1px 0 #042414",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {account.screenName}
                      </span>
                    </div>
                    {account.email && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#a9c9b3",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {account.email}
                      </span>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <WinsTodayChip winsToday={account.winsToday ?? 0} />
                      {standing != null && standing.sharkLevel > 0 && (
                        <span
                          style={{
                            fontFamily: "VT323",
                            fontSize: 14,
                            lineHeight: 1,
                            color: "#9fc6ff",
                            textShadow: "1px 1px 0 #042414",
                          }}
                        >
                          🦈{standing.sharkLevel}
                        </span>
                      )}
                    </div>
                  </div>
                  {standing != null && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span
                        style={{
                          fontFamily: "VT323",
                          fontSize: 22,
                          lineHeight: 1,
                          color: "#ffe98a",
                          textShadow: "1px 1px 0 #042414",
                        }}
                      >
                        {standing.bpm.toFixed(1)} BPM
                      </span>
                      <span
                        style={{
                          fontFamily: "VT323",
                          fontSize: 16,
                          lineHeight: 1,
                          color: standing.accuracy != null ? "#b9e6c4" : "#8aa593",
                          textShadow: "1px 1px 0 #042414",
                        }}
                      >
                        {standing.accuracy != null ? `${standing.accuracy}% ACC` : "—% ACC"}
                      </span>
                    </div>
                  )}
                  {canEditName && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        className="btn"
                        disabled={updateTheme.isPending}
                        title="Cycle theme"
                        onClick={() => {
                          const idx = THEME_CYCLE.indexOf(effectiveTheme as (typeof THEME_CYCLE)[number]);
                          handleChangeTheme(THEME_CYCLE[(idx < 0 ? 0 : idx + 1) % THEME_CYCLE.length] as AccountProfileTheme);
                        }}
                      >
                        {THEME_DOT[themeColorOf(effectiveTheme)]}
                      </button>
                      <button className="btn" onClick={() => setEditing(true)}>Edit</button>
                    </div>
                  )}
                </div>
                {!canEditName && (
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
                      Set a custom screen name
                    </button>
                    {" with a Lifetime Pass."}
                  </div>
                )}
              </>
            )}
            {!editing && (
              <div style={{ fontSize: 14, color: "#444", marginTop: 1, textAlign: "center" }}>
                📺{" "}
                <a
                  href={`/watch/${encodeURIComponent(account.screenName)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setLocation(`/watch/${encodeURIComponent(account.screenName)}`);
                  }}
                  style={{ color: "#000080" }}
                >
                  breakbpm.com/watch/{account.screenName}
                </a>
              </div>
            )}
            {error && <div style={{ color: "#c00", fontSize: 12 }}>{error}</div>}
          </div>
        </div>

        {/* Tier panel */}
        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🎖️</span>Tier</span></div>
          <div className="panel-body">
            <div style={{ fontFamily: "VT323", fontSize: 24, color: ent.tier === "pass" ? "#006400" : "#000080", textAlign: "center" }}>
              {tierLabel}
            </div>
            {ent.activePass && (
              <div style={{ fontSize: 12, marginTop: 4, textAlign: "center" }}>
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

        {/* Admin code generator — only rendered for accounts on the
            BREAKBPM_ADMIN_EMAILS allowlist (server enforces 403 regardless).
            Mints a pass-granting comp code of the chosen tier with an optional
            redemption cap. */}
        {isAdmin && (
          <div className="panel">
            <div className="panel-header">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🛠️</span>Admin — Generate Codes
              </span>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ fontSize: 11, color: "#444", margin: 0 }}>
                Mint a redeemable code that grants the selected pass tier. Codes
                never expire and can be redeemed up to the chosen number of times.
              </p>
              <label style={{ fontSize: 12 }}>
                Tier
                <select
                  className="input"
                  style={{ marginTop: 4 }}
                  value={adminKind}
                  onChange={(e) => setAdminKind(e.target.value as AdminCodeInputKind)}
                  disabled={createAdminCode.isPending}
                >
                  <option value="day">Day Pass</option>
                  <option value="twoweek">14 Day Pass</option>
                  <option value="month">Month Pass</option>
                  <option value="year">Year Pass</option>
                  <option value="lifetime">Lifetime Pass</option>
                </select>
              </label>
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={adminUnlimited}
                  onChange={(e) => setAdminUnlimited(e.target.checked)}
                  disabled={createAdminCode.isPending}
                />
                Unlimited uses
              </label>
              {!adminUnlimited && (
                <label style={{ fontSize: 12 }}>
                  Max uses
                  <input
                    className="input"
                    style={{ marginTop: 4 }}
                    type="number"
                    min={1}
                    step={1}
                    value={adminUses}
                    onChange={(e) => setAdminUses(e.target.value)}
                    disabled={createAdminCode.isPending}
                  />
                </label>
              )}
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={autoDownloadCard}
                  onChange={(e) => setAutoDownloadCard(e.target.checked)}
                  disabled={createAdminCode.isPending}
                />
                Auto-download card + assign artwork
              </label>
              <button
                className="btn btn-primary w-full"
                disabled={createAdminCode.isPending}
                onClick={handleCreateAdminCode}
              >
                {createAdminCode.isPending ? "Generating…" : "Generate Code"}
              </button>
              {adminMsg && (
                <div className="notice">
                  <span>ℹ</span>
                  <span>{adminMsg}</span>
                </div>
              )}
              {/* Off-screen QR feeding the card renderer. It paints in its own
                  effect (before the draw effect) whenever `card` changes. */}
              {card && (
                <div style={{ position: "absolute", left: -99999, top: 0 }} aria-hidden="true">
                  <QRCodeCanvas
                    key={card.code}
                    ref={qrCanvasRef}
                    value={redeemUrlFor(card.code)}
                    size={560}
                    level="M"
                  />
                </div>
              )}
              {/* Generated card preview — also lets the admin long-press to
                  save on mobile if the auto-download was blocked. */}
              {card && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontFamily: "VT323", fontSize: 16, marginBottom: 4 }}>
                    Shareable Card
                  </div>
                  <canvas
                    ref={cardCanvasRef}
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      border: "1px solid #999",
                    }}
                    aria-label={`Redeem card for ${card.code}`}
                  />
                  <button
                    className="btn w-full"
                    style={{ marginTop: 6 }}
                    onClick={() => {
                      if (cardCanvasRef.current)
                        downloadCanvas(cardCanvasRef.current, cardFilename(card.code));
                    }}
                  >
                    Download Card
                  </button>
                </div>
              )}
              {adminCodes.data && adminCodes.data.codes.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontFamily: "VT323", fontSize: 16, marginBottom: 4 }}>
                    Recent Codes
                  </div>
                  {adminCodes.data.codes.map((c) => (
                    <div
                      key={c.code}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        marginBottom: 4,
                        background: "#f5f5dc",
                        border: "1px solid #999",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "monospace",
                            fontSize: 14,
                            wordBreak: "break-all",
                          }}
                        >
                          {c.code}
                        </div>
                        <div style={{ fontSize: 10, color: "#444" }}>
                          {c.grantsPassKind.toUpperCase()} ·{" "}
                          {c.maxRedemptions === null
                            ? `${c.redemptionCount} used (unlimited)`
                            : `${c.redemptionCount}/${c.maxRedemptions} used`}
                          {c.backgroundVariant ? " · 🎨 art" : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn" onClick={() => handleCopyAdmin(c.code)}>
                          {adminCopied === c.code ? "Copied" : "Copy"}
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            handleMakeCard(
                              c.code,
                              c.grantsPassKind,
                              c.backgroundVariant ?? null,
                            )
                          }
                        >
                          Card
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Admin sales/revenue ledger — gated on isAdmin (endpoint 403s too). */}
        {isAdmin && <AdminSalesPanel />}

        {/* Admin verified-venues manager — gated on isAdmin (endpoint 403s too). */}
        {isAdmin && <AdminVenuesPanel />}

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

        {/* @Mention invites panel — only when the caller has any invites */}
        {invites.data && invites.data.invites.length > 0 && (
          <div className="panel panel--wood">
            <div className="panel-header">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🔗</span>Game Invites
              </span>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {inviteMsg && (
                <p style={{ fontSize: 11, color: "#ffd2d2", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{inviteMsg}</p>
              )}
              {invites.data.invites.map((inv) => {
                const busy = inviteBusyId === inv.id;
                return (
                  <div key={inv.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#cdeccd" }}>
                      {inv.status === "pending" ? "Invited by " : "Linked by "}
                      <strong>{inv.invitedBy}</strong>
                      {inv.status === "accepted" ? " · counts toward your stats" : ""}
                    </span>
                    <GameHistoryCard game={inv.game} />
                    <div style={{ display: "flex", gap: 6 }}>
                      {inv.status === "pending" && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => handleAcceptInvite(inv.id)}
                        >
                          {busy ? "…" : "Accept"}
                        </button>
                      )}
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => handleRemoveInvite(inv.id)}
                      >
                        {busy ? "…" : inv.status === "pending" ? "Delete" : "Remove"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* History panel */}
        <div className="panel panel--wood">
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
              <p style={{ fontSize: 12, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>No games saved yet. Play one!</p>
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
                <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
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
