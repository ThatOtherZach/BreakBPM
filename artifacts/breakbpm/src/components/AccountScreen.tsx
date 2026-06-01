import { useState, useEffect } from "react";
import { useAuth, signInPath } from "../lib/authClient";
import {
  useGetMe,
  useUpdateScreenName,
  useGetGameHistory,
  useDevGrantLifetime,
  useListMyGiftCodes,
  useGenerateGiftCode,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
  getListMyGiftCodesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import SharkIcon from "./SharkIcon";
import { SHARK_PLAYER_NAME, SOLIDS } from "../lib/gameLogic";

const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};

interface PocketEvent {
  ball: number;
  player: string;
}

interface PocketRun {
  player: string;
  balls: number[];
}

/** Collapse the flat pocket sequence into consecutive same-shooter runs so
 *  each shooter's balls can be labeled once and grouped together. */
function toRuns(seq: PocketEvent[]): PocketRun[] {
  const runs: PocketRun[] = [];
  for (const ev of seq) {
    const last = runs[runs.length - 1];
    if (last && last.player === ev.player) last.balls.push(ev.ball);
    else runs.push({ player: ev.player, balls: [ev.ball] });
  }
  return runs;
}

/**
 * A single, non-wrapping line of the balls pocketed during a game, in order.
 * Balls are grouped into consecutive same-shooter runs; each run is labeled by
 * its shooter (a name pill, or the shark fin for Shark steals) so attribution
 * is explicit even in 9-ball and open-table 8-ball where ball color alone does
 * not identify the shooter. Scrolls horizontally when wider than the row.
 */
function ShotLogRow({ seq }: { seq: PocketEvent[] }) {
  const runs = toRuns(seq);
  return (
    <div className="shotlog-row">
      <div className="shotlog-scroll">
        {runs.map((run, ri) => {
          const isShark = run.player === SHARK_PLAYER_NAME;
          return (
            <span
              key={ri}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginLeft: ri > 0 ? 9 : 0,
                flexShrink: 0,
              }}
            >
              {isShark ? (
                <SharkIcon size={13} />
              ) : (
                run.player && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#555",
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {run.player}
                  </span>
                )
              )}
              {run.balls.map((ball, bi) => {
                const chipClass =
                  ball === 8
                    ? "hud-chip-eight"
                    : SOLIDS.includes(ball)
                      ? "hud-chip-solid"
                      : "hud-chip-stripe";
                return (
                  <span
                    key={bi}
                    className={`hud-chip hud-chip-sm ${chipClass}`}
                    data-number={ball}
                    style={{ "--chip-color": BALL_COLORS[ball] } as React.CSSProperties}
                    aria-label={`Ball ${ball} by ${isShark ? "Shark" : run.player || "player"}`}
                  />
                );
              })}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  onBack: () => void;
  onPasses: () => void;
  onAbout: () => void;
  onSignIn: () => void;
}

function fmtMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString();
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

const GAME_TYPE_LABEL: Record<string, string> = {
  "8ball": "8-Ball",
  "9ball": "9-Ball",
  practice: "Practice",
};

type OutcomeStyle = { label: string; bg: string; fg: string; border: string; title?: string };
const OUTCOME_STYLE: Record<string, OutcomeStyle> = {
  won: { label: "WIN", bg: "#2e7d32", fg: "#fff", border: "#1b5e20" },
  lost: { label: "LOSS", bg: "#c62828", fg: "#fff", border: "#8e1b1b" },
  forfeit: {
    label: "DNF",
    bg: "#dddddd",
    fg: "#444",
    border: "#999",
    title: "Forfeit — Did Not Finish",
  },
  completed: { label: "DONE", bg: "#c0c0c0", fg: "#000080", border: "#808080" },
};

function ResultBadge({ outcome }: { outcome: string }) {
  const s = OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.completed;
  return (
    <span
      title={s.title}
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: "bold",
        letterSpacing: 0.5,
        padding: "1px 6px",
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      {s.label}
    </span>
  );
}

export default function AccountScreen({ onBack, onPasses, onAbout, onSignIn }: Props) {
  const { logout: signOut } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  // TODO(remove-before-launch): paired with the dev upgrade button below.
  const [devGrantError, setDevGrantError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [giftMsg, setGiftMsg] = useState("");
  const [giftCopied, setGiftCopied] = useState(false);
  // Force a re-render every 5 minutes so the cooldown / "expires in ~Xh"
  // labels in the gift panel drift naturally without spamming setInterval.
  const [, setClockTick] = useState(0);

  const me = useGetMe();
  const history = useGetGameHistory({ page: historyPage });
  const updateName = useUpdateScreenName();
  // TODO(remove-before-launch): dev-only free Lifetime upgrade hook.
  const devGrant = useDevGrantLifetime();
  const myGiftCodes = useListMyGiftCodes();
  const generateGift = useGenerateGiftCode();

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
        <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
        <div className="app-body">
          <p style={{ fontFamily: "VT323", fontSize: 18 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!me.data?.signedIn) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
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
      setError(e instanceof Error ? e.message : "Update failed");
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

  // TODO(remove-before-launch): dev-only free Lifetime upgrade handler.
  async function handleDevGrant() {
    setDevGrantError("");
    try {
      await devGrant.mutateAsync();
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setDevGrantError(e instanceof Error ? e.message : "Upgrade failed");
    }
  }

  async function handleSignOut() {
    await signOut();
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
    onBack();
  }

  const tierLabel =
    ent.tier === "pass"
      ? ent.activePass?.kind === "lifetime" ? "Lifetime Pass ★"
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
                  maxLength={32}
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
                  Upgrade to Lifetime
                </button>
                {" to customise your screen name."}
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
                        {latest && (
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
            {/* TODO(remove-before-launch): dev-only free Lifetime upgrade button.
                Rip out together with useDevGrantLifetime import, devGrant state,
                handleDevGrant, and the server-side DEV_FREE_UPGRADE_ENABLED flag.
                Visibility mirrors the server flag exposed on /auth/me. */}
            {!canEditName && me.data.devFreeUpgradeEnabled && (
              <>
                <button
                  className="btn btn-big w-full"
                  style={{
                    marginTop: 8,
                    background: "#90ee90",
                    color: "#003200",
                    fontWeight: "bold",
                  }}
                  disabled={devGrant.isPending}
                  onClick={handleDevGrant}
                >
                  {devGrant.isPending ? "Upgrading…" : "🎉 Upgrade for Free!"}
                </button>
                {devGrantError && (
                  <div style={{ color: "#c00", fontSize: 12, marginTop: 4 }}>
                    {devGrantError}
                  </div>
                )}
              </>
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
            {history.data?.games.map((g) => {
              const modeLabel = GAME_TYPE_LABEL[g.gameType] ?? g.gameType;
              const hasBpm = g.bpm != null;
              return (
                <div
                  key={g.id}
                  style={{
                    borderTop: "1px solid #aaa",
                    padding: "6px 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                 <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Left: mode + result + winner */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontWeight: "bold", fontSize: 13 }}>{modeLabel}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#444", fontSize: 11 }}>
                      <ResultBadge outcome={g.outcome} />
                      {(g.winner || g.sharkMode) && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                          {g.sharkMode && <SharkIcon size={12} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {g.sharkMode
                              ? (g.winner === SHARK_PLAYER_NAME ? "Shark'd" : "Beat the Shark")
                              : g.winner}
                          </span>
                        </span>
                      )}
                    </span>
                    {g.endReason && (
                      <span style={{ fontSize: 10, color: "#777", fontStyle: "italic" }}>
                        {g.endReason === "max_duration_60min"
                          ? "Ended — 60 min cap reached"
                          : "Ended — inactive for 60 min"}
                      </span>
                    )}
                  </div>

                  {/* Right: BPM hero + time · date */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span
                      style={{
                        fontFamily: "VT323",
                        fontSize: 26,
                        lineHeight: 1,
                        color: hasBpm ? "#000080" : "#999",
                      }}
                    >
                      {hasBpm ? `${g.bpm!.toFixed(1)} BPM` : "— BPM"}
                    </span>
                    <span style={{ fontSize: 10, color: "#666" }}>
                      🕐 {fmtMs(g.durationMs)} · {fmtDate(g.endedAt)}
                    </span>
                  </div>
                 </div>

                  {/* Bottom: visual shot log — balls in pocket order */}
                  {g.pocketSequence && g.pocketSequence.length > 0 && (
                    <ShotLogRow seq={g.pocketSequence} />
                  )}
                </div>
              );
            })}

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
    </div>
  );
}
