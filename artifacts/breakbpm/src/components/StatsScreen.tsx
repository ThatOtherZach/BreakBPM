import { useEffect, useState } from "react";
import {
  useGetStats,
  getStats,
  getGetStatsQueryKey,
  useGetGameHistory,
  getGetGameHistoryQueryKey,
  useGetMe,
  getGetMeQueryKey,
  exportMyGames,
  deleteMyGameData,
} from "@workspace/api-client-react";
import type { GetStatsParams, StatsResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import { useAuth } from "../lib/authClient";
import { SOLIDS } from "../lib/gameLogic";
import StatsHero, { BALL_COLORS, fmtInt, fmtPct } from "./StatsHero";
import { THEME_ACCENT } from "../lib/backgroundVariants";

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
  onPasses: () => void;
}

const WINDOW_LABEL: Record<string, string> = {
  "24h": "24H",
  "30d": "30D",
  "365d": "1Y",
  all: "ALL",
};
const WINDOWS: Array<"24h" | "30d" | "365d" | "all"> = ["24h", "30d", "365d", "all"];
const GAME_MODES: Array<"all" | "8ball" | "9ball" | "practice" | "shark"> = ["all", "8ball", "9ball", "practice", "shark"];
const GAME_MODE_LABEL: Record<string, string> = {
  all: "All Modes",
  "8ball": "8-Ball",
  "9ball": "9-Ball",
  practice: "Practice",
  shark: "🦈 Shark",
};

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(Math.ceil(v * 2) / 2);
}
function fmtCeil(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(Math.ceil(v));
}
function fmtWhen(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

type Tone = "green" | "amber" | "cyan" | "red";

/** A recessed CRT gauge: glowing notched fill bar scaled 0..100. */
function PixelMeter({
  label,
  emoji,
  pct,
  display,
  tone = "green",
}: {
  label: string;
  emoji?: React.ReactNode;
  pct: number | null | undefined;
  display: string;
  tone?: Tone;
}) {
  const w = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="stats-meter-row">
      <div className="stats-meter-top">
        <span className="stats-meter-name font-semibold">
          {emoji && <span aria-hidden="true">{emoji}</span>}
          {label}
        </span>
        <span className="stats-meter-val">{display}</span>
      </div>
      <div className="stats-meter-track">
        <div className={`stats-meter-fill ${tone}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/** Raised silver chip with an emoji glyph + big VT323 value. */
function StatCard({
  emoji,
  value,
  label,
  sub,
}: {
  emoji: React.ReactNode;
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="stats-card">
      <span className="stats-card-emoji" aria-hidden="true">{emoji}</span>
      <span className="stats-card-val">{value}</span>
      <span className="stats-card-label">{label}</span>
      {sub && <span className="stats-card-sub">{sub}</span>}
    </div>
  );
}

function SectionHeader({ emoji, title }: { emoji: string; title: string }) {
  return (
    <div className="panel-header">
      <span>
        <span className="stats-sec-emoji" aria-hidden="true">{emoji}</span>
        {title}
      </span>
    </div>
  );
}

export default function StatsScreen({ onBack, onAbout, onAccount, onFindPlayers, onSignIn, onPasses }: Props) {
  const qc = useQueryClient();
  const { isAuthenticated, user } = useAuth();

  const meQuery = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: isAuthenticated } });
  const joinedAt = meQuery.data?.account?.createdAt;

  // A minimal history fetch (1 result) gives us totalCount for ALL the user's
  // games regardless of the stats window, so we can disable Export/Delete
  // when there is genuinely nothing to act on.
  const historyCountQuery = useGetGameHistory(
    undefined,
    { query: { queryKey: getGetGameHistoryQueryKey(), enabled: isAuthenticated } },
  );
  const hasNoData =
    isAuthenticated &&
    historyCountQuery.data != null &&
    historyCountQuery.data.totalCount === 0;

  const [window, setWindow] = useState<"24h" | "30d" | "365d" | "all">("24h");
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [gameMode, setGameMode] = useState<"all" | "8ball" | "9ball" | "practice" | "shark">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The delete button is a two-click confirm: the first click arms it and the
  // second click within the window actually deletes. Auto-disarm after a few
  // seconds (or on unmount / navigate-away) so a stale "Are you sure?" can't
  // linger and be hit by accident.
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const csv = await exportMyGames();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `breakbpm-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Surface nothing — the page state is unchanged on failure.
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteMyGameData();
      // Wipe every cached read so Stats, history, and resume all reflect the
      // now-empty data instead of showing the deleted games.
      await qc.invalidateQueries();
    } catch {
      // Surface nothing — a failed delete leaves the data intact.
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // `refresh` is intentionally left out of the query key so cache-busting is
  // an explicit user action (handleRefresh) rather than part of normal reads.
  const params: GetStatsParams = { window, scope, gameMode };
  const statsQuery = useGetStats(params);
  const stats = statsQuery.data as StatsResult | undefined;

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const fresh = await getStats({ window, scope, gameMode, refresh: true });
      qc.setQueryData(getGetStatsQueryKey(params), fresh);
    } catch {
      // Surface nothing — the existing snapshot stays on screen.
    } finally {
      setRefreshing(false);
    }
  }

  const canChooseWindow = stats?.canChooseWindow ?? false;
  const canToggleGlobal = stats?.canToggleGlobal ?? false;
  const canRefresh = stats?.canRefresh ?? false;
  // Free signed-in tier: their export is capped to the last 24h, so the button
  // says so; pass holders get a plain "Export" of their full history.
  const isFreeTier = stats?.tier === "account";
  const appliedScope = stats?.appliedScope ?? "personal";
  const appliedWindow = stats?.appliedWindow ?? "24h";
  const isPersonal = appliedScope === "personal";

  // Largest most-sunk count, used to scale the ball-frequency bars.
  const maxBallCount = stats
    ? Math.max(1, ...stats.topBalls.map((b) => b.count))
    : 1;

  const rateLabel = isPersonal ? "WIN RATE" : "FINISH RATE";
  const rateValue = isPersonal ? stats?.winRate : stats?.finishRate;

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onAccount={onAccount} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
      <div className="app-body">
        {/* ── Controls — only shown when signed in ── */}
        {isAuthenticated && <div className="panel">
          <div className="panel-header">
            <span>
              <span className="stats-sec-emoji" aria-hidden="true">📊</span>
              Statistics
            </span>
            {stats && (
              <span style={{ fontSize: 10, color: "#cdd9f0", fontWeight: "normal" }}>
                {stats.cached ? "cached" : "fresh"} · {fmtWhen(stats.computedAt)}
              </span>
            )}
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Scope + Timeframe selectors: each is a single cycle-button. */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {/* Scope: cycles Me ↔ Everyone on click */}
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!canToggleGlobal}
                onClick={() => setScope(scope === "personal" ? "global" : "personal")}
                title={canToggleGlobal ? undefined : "Get a pass to compare against everyone"}
              >
                {appliedScope === "personal" ? "🙋 Me" : "🌍 Everyone"}
                {!canToggleGlobal ? " 🔒" : " ▸"}
              </button>
              {/* Window: cycles 24H → 30D → 1Y → ALL → … (pass holders only) */}
              {canChooseWindow && (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, padding: "6px 4px" }}
                  onClick={() => {
                    const idx = WINDOWS.indexOf(window);
                    setWindow(WINDOWS[(idx + 1) % WINDOWS.length]);
                  }}
                >
                  {WINDOW_LABEL[appliedWindow]} ▸
                </button>
              )}
            </div>

            {/* Game mode cycle + Refresh on the same row (pass holders only) */}
            {canChooseWindow && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    const idx = GAME_MODES.indexOf(gameMode);
                    setGameMode(GAME_MODES[(idx + 1) % GAME_MODES.length]);
                  }}
                >
                  {GAME_MODE_LABEL[gameMode]} ▸
                </button>
                {canRefresh && (
                  <button
                    className="btn"
                    style={{ flexShrink: 0 }}
                    disabled={refreshing || statsQuery.isFetching}
                    onClick={handleRefresh}
                  >
                    {refreshing ? "↻ Refreshing…" : "↻ Refresh"}
                  </button>
                )}
              </div>
            )}

            {/* Refresh (non-pass tier) */}
            {canRefresh && !canChooseWindow && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={refreshing || statsQuery.isFetching}
                  onClick={handleRefresh}
                >
                  {refreshing ? "↻ Refreshing…" : "↻ Refresh"}
                </button>
              </div>
            )}
            {/* Export + Delete (all authenticated personal-scope users) */}
            {isAuthenticated && isPersonal && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={exporting || deleting || hasNoData}
                  onClick={handleExport}
                  title={
                    hasNoData
                      ? "No games to export"
                      : isFreeTier
                        ? "Download your last 24 hours of games as a CSV spreadsheet — get a pass to export your full history"
                        : "Download all your games and shots as a CSV spreadsheet"
                  }
                >
                  {exporting ? "🧳 Exporting…" : isFreeTier ? "🧳 Export (24h)" : "🧳 Export"}
                </button>
                <button
                  className={`btn${confirmDelete ? " btn-primary" : ""}`}
                  style={{ flex: 1 }}
                  disabled={deleting || exporting || hasNoData}
                  onClick={handleDelete}
                  title={hasNoData ? "No games to delete" : "Permanently delete all your games and shots"}
                >
                  {deleting
                    ? "☢️ Deleting…"
                    : confirmDelete
                      ? "☢️ Are you sure?"
                      : "☢️ Delete"}
                </button>
              </div>
            )}

            {isAuthenticated && isFreeTier && (
              <p style={{ fontSize: 11, color: "#555", margin: 0, lineHeight: 1.4 }}>
                🔓 Free exports cover the last 24h —{" "}
                <button
                  type="button"
                  onClick={onPasses}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#1F4E9E",
                    textDecoration: "underline",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  get a pass
                </button>{" "}
                for your full history.
              </p>
            )}
          </div>
        </div>}

        {statsQuery.isLoading && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>▌ Loading…</p>
            </div>
          </div>
        )}

        {statsQuery.isError && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontSize: 12, color: "#c00" }}>⚠ Couldn't load stats. Try again shortly.</p>
            </div>
          </div>
        )}

        {stats && !statsQuery.isLoading && (
          <>
            {stats.gamesPlayed === 0 ? (
              <div className="panel">
                <div className="panel-body">
                  <p style={{ fontSize: 13, color: "#444" }}>
                    {isPersonal
                      ? "🎱 No completed games in this window yet. Go sink some balls!"
                      : "🎱 No completed games in this window yet."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* ── CRT hero readout — only shown when signed in ── */}
                {isAuthenticated && <StatsHero stats={stats} screenName={user?.screenName} rainbowName={(meQuery.data?.entitlement.isAdmin ?? false) || (meQuery.data?.entitlement.tier === "pass" && meQuery.data?.account?.profileTheme === "rainbow")} joinedAt={joinedAt} />}

                {/* ── Upsell for non-pass tiers ── */}
                {stats.tier !== "pass" && (
                  <div className="stats-upsell">
                    <p style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>
                      {stats.tier === "public"
                        ? "🔓 Sign in to get more detailed statistics and track your games. Get a pass to unlock longer windows, leaderboards, as well as full data export."
                        : "🔓 Get a pass to unlock 30-day, 1-year and all-time windows, the global comparison view, and manual refresh."}
                    </p>
                    <button
                      className="btn btn-primary w-full"
                      onClick={stats.tier === "public" ? onSignIn : onAccount}
                    >
                      {stats.tier === "public" ? "Sign In" : "Get a Pass"}
                    </button>
                  </div>
                )}

                {/* ── Results ── */}
                <div className="panel panel--wood">
                  <SectionHeader emoji="🏆" title="Results" />
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <PixelMeter
                      label={rateLabel}
                      emoji={isPersonal ? "🥇" : "🏁"}
                      pct={rateValue == null ? null : rateValue * 100}
                      display={fmtPct(rateValue)}
                      tone="green"
                    />
                    {isPersonal && (stats.sharkGames ?? 0) > 0 && (
                      <PixelMeter
                        label="🦈 SHARK WIN RATE"
                        pct={stats.sharkWinRate == null ? null : stats.sharkWinRate * 100}
                        display={fmtPct(stats.sharkWinRate)}
                        tone="cyan"
                      />
                    )}
                  </div>
                </div>

                {/* ── Shooting ── */}
                <div className="panel panel--wood">
                  <SectionHeader emoji="🎯" title="Shooting" />
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <PixelMeter
                      label="ACCURACY"
                      emoji={stats.topBalls.length > 0 ? (() => {
                        const top = stats.topBalls[0].ball;
                        const chipClass =
                          top === 8
                            ? "hud-chip-eight"
                            : SOLIDS.includes(top)
                              ? "hud-chip-solid"
                              : "hud-chip-stripe";
                        return (
                          <span
                            className={`hud-chip hud-chip-sm ${chipClass}`}
                            data-number={top}
                            style={{ "--chip-color": BALL_COLORS[top] } as React.CSSProperties}
                          />
                        );
                      })() : "🎯"}
                      pct={stats.accuracy}
                      display={stats.accuracy == null ? "—" : `${stats.accuracy}%`}
                      tone="green"
                    />
                    <PixelMeter
                      label="FOUL RATE"
                      emoji={<span className="cue-ball-icon" style={{ fontSize: 14, verticalAlign: "baseline" }} />}
                      pct={stats.totalShots > 0 ? (stats.totalFouls / stats.totalShots) * 100 : null}
                      display={stats.totalShots > 0 ? `${Math.round((stats.totalFouls / stats.totalShots) * 100)}%` : "—"}
                      tone="red"
                    />
                    {isAuthenticated && (
                      <div className="stats-card-grid">
                        <StatCard emoji="❌" value={fmtNum(stats.avgMissesPerGame)} label="MISSES" sub="per game" />
                        <StatCard emoji={<span className="cue-ball-icon" style={{ fontSize: 21, verticalAlign: "baseline" }} />} value={fmtCeil(stats.avgFoulsPerGame)} label="FOULS" sub="per game" />
                        <StatCard emoji="🛡️" value={fmtCeil(stats.avgSafetiesPerGame)} label="SAFETIES" sub="per game" />
                        <StatCard emoji="↩️" value={fmtInt(stats.totalUndos)} label="TIMES NO ONE SAW THAT (UNDOS)" />
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Pace ── */}
                <div className="panel panel--wood">
                  <SectionHeader emoji="⚡" title="Pace" />
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div className="digit-display">
                          <div className="digit-bpm">{stats.avgBpm == null ? "--" : stats.avgBpm.toFixed(1)}</div>
                        </div>
                        <div className="digit-label">AVG BPM</div>
                      </div>
                      {isAuthenticated && (
                        <div style={{ flex: 1 }}>
                          <div className="digit-display">
                            <div className="digit-bpm" style={{ color: "var(--amber)" }}>
                              {stats.bestBpm == null ? "--" : stats.bestBpm.toFixed(1)}
                            </div>
                          </div>
                          <div className="digit-label">BEST BPM</div>
                        </div>
                      )}
                    </div>
                    {isAuthenticated && stats.playTimeByType.length > 0 && (() => {
                      const totalMs = stats.playTimeByType.reduce((sum, p) => sum + p.avgDurationMs * p.gameCount, 0);
                      const totalGames = stats.playTimeByType.reduce((sum, p) => sum + p.gameCount, 0);
                      const totalHours = totalMs / 3_600_000;
                      const avgPerGameMin = totalGames > 0 ? totalMs / totalGames / 60_000 : 0;
                      return (
                        <p
                          style={{ fontSize: 12, color: "#fff", textShadow: "0 1px 1px rgba(0,0,0,0.7)", margin: 0 }}
                          className="text-center font-semibold">🕐 {totalHours.toFixed(1)} Hours Played - {avgPerGameMin.toFixed(1)} Min Per Game (Average)
                                                                            </p>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Game Modes pie ── */}
                {isAuthenticated && stats.playTimeByType.length > 0 && (() => {
                  const total = stats.playTimeByType.reduce((s, p) => s + p.gameCount, 0);
                  if (total === 0) return null;
                  const MODE_COLORS: Record<string, string> = {
                    "8ball": THEME_ACCENT.green,
                    "9ball": "#ffd700",
                    practice: THEME_ACCENT.purple,
                    shark: THEME_ACCENT.blue,
                  };
                  const MODE_PCT_COLORS = MODE_COLORS;
                  const MODE_LABELS: Record<string, string> = {
                    "8ball": "8-BALL",
                    "9ball": "9-BALL",
                    practice: "PRACTICE",
                    shark: "🦈 SHARK",
                  };
                  const fmtHHMM = (ms: number) => {
                    const totalMin = Math.floor(ms / 60000);
                    const hh = Math.floor(totalMin / 60);
                    const mm = totalMin % 60;
                    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
                  };
                  const cx = 80, cy = 80, r = 68;
                  let angle = -Math.PI / 2;
                  const slices = stats.playTimeByType.map((p) => {
                    const sweep = (p.gameCount / total) * 2 * Math.PI;
                    const start = angle;
                    angle += sweep;
                    return { ...p, start, sweep };
                  });
                  const arcPath = (start: number, sweep: number) => {
                    if (sweep >= 2 * Math.PI - 0.001) {
                      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
                    }
                    const x1 = cx + r * Math.cos(start);
                    const y1 = cy + r * Math.sin(start);
                    const x2 = cx + r * Math.cos(start + sweep);
                    const y2 = cy + r * Math.sin(start + sweep);
                    const large = sweep > Math.PI ? 1 : 0;
                    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
                  };
                  return (
                    <div className="stats-hero">
                      <SectionHeader emoji="📊" title="Game Modes" />
                      <div className="panel-body" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
                        <svg width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
                          <defs>
                            <pattern id="gm-scan" width="1" height="3" patternUnits="userSpaceOnUse">
                              <rect width="1" height="1" fill="#000" />
                            </pattern>
                          </defs>
                          {slices.map((s) => (
                            <path
                              key={s.gameType}
                              d={arcPath(s.start, s.sweep)}
                              fill={MODE_COLORS[s.gameType] ?? "#888"}
                              stroke="#042414"
                              strokeWidth={2}
                            />
                          ))}
                          <rect width="160" height="160" fill="url(#gm-scan)" opacity={0.12} style={{ pointerEvents: "none" }} />
                        </svg>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {[...slices].sort((a, b) => b.gameCount - a.gameCount).map((s) => {
                            const pct = Math.round((s.gameCount / total) * 100);
                            return (
                              <div key={s.gameType} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 10, height: 10, background: MODE_COLORS[s.gameType] ?? "#888", display: "inline-block", flexShrink: 0, border: "1px solid #042414" }} />
                                <span style={{ fontFamily: "VT323", fontSize: 16, color: "#f4f4dc", textShadow: "1px 1px 0 #042414", lineHeight: 1 }}>
                                  {MODE_LABELS[s.gameType] ?? s.gameType.toUpperCase()}{" "}
                                  <span style={{ color: MODE_PCT_COLORS[s.gameType] ?? "#f4f4dc" }}>{pct}%</span>
                                  {" "}<span style={{ color: "#fff" }}>({s.gameCount})</span>
                                  {" "}<span style={{ color: "#a9c9b3" }}>🕐{fmtHHMM(s.avgDurationMs * s.gameCount)}</span>
                                </span>
                              </div>
                            );
                          })}
                          <span style={{ fontFamily: "VT323", fontSize: 14, color: "#f4f4dc", textShadow: "1px 1px 0 #042414", marginTop: 2 }}>
                            {total} TOTAL
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Patterns — personal scope only ── */}
                {isPersonal && (
                  <div className="panel panel--wood">
                    <SectionHeader emoji="🎱" title="Ball Patterns" />
                    <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {/* Solids vs stripes split */}
                      {((stats.solidsCount ?? 0) > 0 || (stats.stripesCount ?? 0) > 0) && (() => {
                        const solids = stats.solidsCount ?? 0;
                        const stripes = stats.stripesCount ?? 0;
                        const total = solids + stripes;
                        const solidsPct = total > 0 ? (solids / total) * 100 : 0;
                        const stripesPct = total > 0 ? (stripes / total) * 100 : 0;
                        // Tint each segment with the color of the most-shot ball in
                        // that group (ties resolve to the lower ball number, since we
                        // scan ascending and only replace on a strictly greater count).
                        const counts = new Map(stats.topBalls.map((b) => [b.ball, b.count]));
                        const topColor = (balls: number[]): string | null => {
                          let best: number | null = null;
                          let bestCount = 0;
                          for (const b of balls) {
                            const c = counts.get(b) ?? 0;
                            if (c > bestCount) { bestCount = c; best = b; }
                          }
                          return best == null ? null : BALL_COLORS[best];
                        };
                        const solidColor = topColor([1, 2, 3, 4, 5, 6, 7]);
                        const stripeColor = topColor([9, 10, 11, 12, 13, 14, 15]);
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div className="stats-bar-top">
                              <span className="font-semibold">Solids {Math.round(solidsPct)}%</span>
                              <span className="font-semibold">{Math.round(stripesPct)}% Stripes</span>
                            </div>
                            <div className="stats-split-track">
                              <span className="stats-split-seg solids" style={{ width: `${solidsPct}%`, ...(solidColor ? { background: solidColor } : null) }} />
                              <span className="stats-split-seg stripes" style={{ width: `${stripesPct}%`, ...(stripeColor ? { backgroundImage: `repeating-linear-gradient(90deg, ${stripeColor} 0, ${stripeColor} 4px, #fffef2 4px, #fffef2 8px)` } : null) }} />
                            </div>
                          </div>
                        );
                      })()}

                      {(() => {
                        const ballCounts = new Map(stats.topBalls.map((b) => [b.ball, b.count]));
                        const renderBall = (ball: number) => {
                          const chipClass =
                            ball === 8
                              ? "hud-chip-eight"
                              : SOLIDS.includes(ball)
                                ? "hud-chip-solid"
                                : "hud-chip-stripe";
                          return (
                            <div key={ball} className="stats-ball-item">
                              <span
                                className={`hud-chip ${chipClass}`}
                                data-number={ball}
                                style={{ "--chip-color": BALL_COLORS[ball] } as React.CSSProperties}
                                aria-label={`Ball ${ball}`}
                              />
                              <span className="stats-ball-count">×{ballCounts.get(ball) ?? 0}</span>
                            </div>
                          );
                        };
                        return (
                          <div
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}
                            className="pt-[8px] pb-[8px]">
                            <div className="stats-ball-item">
                              <span className="cue-ball-icon cue-ball-icon--chip" aria-label="Cue ball" />
                              <span className="stats-ball-count">×{fmtInt(stats.totalFouls)}</span>
                            </div>
                            {/* Grouped like the in-game HUD rack: solids cluster
                                left, 8-ball centered, stripes cluster right. */}
                            <div className="stats-ball-grid stats-ball-side">{[1, 2, 3, 4, 5, 6, 7].map(renderBall)}</div>
                            <div className="stats-ball-grid stats-ball-side">{[9, 10, 11, 12, 13, 14, 15].map(renderBall)}</div>
                            {renderBall(8)}
                          </div>
                        );
                      })()}

                      <p
                        style={{ fontSize: 12, color: "#fff", textShadow: "0 1px 1px rgba(0,0,0,0.7)", margin: 0 }}
                        className="text-center font-semibold">
                        🎱 {Math.ceil(stats.avgShotsPerGame)} Shots Per Game (Average)
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}


          </>
        )}
      </div>
    </div>
  );
}
