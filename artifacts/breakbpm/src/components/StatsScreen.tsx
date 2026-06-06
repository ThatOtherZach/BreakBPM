import { useEffect, useState } from "react";
import {
  useGetStats,
  getStats,
  getGetStatsQueryKey,
  useGetGameHistory,
  getGetGameHistoryQueryKey,
  exportMyGames,
  deleteMyGameData,
} from "@workspace/api-client-react";
import type { GetStatsParams, StatsResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import { useAuth } from "../lib/authClient";
import { SOLIDS } from "../lib/gameLogic";

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
  onPasses: () => void;
}

const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};

const WINDOW_LABEL: Record<string, string> = {
  "24h": "24H",
  "30d": "30D",
  "365d": "1Y",
  all: "ALL",
};
const WINDOWS: Array<"24h" | "30d" | "365d" | "all"> = ["24h", "30d", "365d", "all"];

const GAME_TYPE_EMOJI: Record<string, string> = {
  "8ball": "🎱",
  "9ball": "9️⃣",
  practice: "🎯",
};
const GAME_TYPE_LABEL: Record<string, string> = {
  "8ball": "8-Ball",
  "9ball": "9-Ball",
  practice: "Practice",
};

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}
function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(v);
}
function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(v);
}
function fmtMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtWhen(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

type Tone = "green" | "amber" | "cyan";

/** A recessed CRT gauge: glowing notched fill bar scaled 0..100. */
function PixelMeter({
  label,
  emoji,
  pct,
  display,
  tone = "green",
}: {
  label: string;
  emoji?: string;
  pct: number | null | undefined;
  display: string;
  tone?: Tone;
}) {
  const w = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="stats-meter-row">
      <div className="stats-meter-top">
        <span className="stats-meter-name">
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

/**
 * Phosphor-green BPM trend sparkline. Plots a series of per-game BPM values
 * (oldest→newest) as a filled line in an SVG that scales to its container, so
 * it sits beside the big AVG BPM readout like a CRT oscilloscope trace.
 */
function BpmSparkline({
  data,
  stroke = "#00ff41",
  fill = "rgba(0, 255, 65, 0.12)",
  ariaLabel = "BPM trend over recent games",
}: {
  data: number[];
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
}) {
  const W = 100;
  const H = 36;
  const pad = 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const n = data.length;
  const x = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return (
    <svg
      className="stats-hero-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <path d={area} fill={fill} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(data[n - 1])} r="1.8" fill={stroke} />
    </svg>
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
  const params: GetStatsParams = { window, scope };
  const statsQuery = useGetStats(params);
  const stats = statsQuery.data as StatsResult | undefined;

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const fresh = await getStats({ window, scope, refresh: true });
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

  // Longest avg game length, used to scale the play-time bars.
  const maxPlayMs = stats
    ? Math.max(1, ...stats.playTimeByType.map((p) => p.avgDurationMs))
    : 1;
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
        {/* ── Controls ── */}
        <div className="panel">
          <div className="panel-header">
            <span>
              <span className="stats-sec-emoji" aria-hidden="true">📊</span>
              Statistics
            </span>
            {stats && (
              <span style={{ fontSize: 10, color: "#666", fontWeight: "normal" }}>
                {stats.cached ? "cached" : "fresh"} · {fmtWhen(stats.computedAt)}
              </span>
            )}
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Scope toggle */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#555", width: 48 }}>Scope</span>
              <button
                className={`btn${appliedScope === "personal" ? " btn-primary" : ""}`}
                style={{ flex: 1 }}
                disabled={!canToggleGlobal && appliedScope !== "personal"}
                onClick={() => setScope("personal")}
              >
                🙋 Me
              </button>
              <button
                className={`btn${appliedScope === "global" ? " btn-primary" : ""}`}
                style={{ flex: 1 }}
                disabled={!canToggleGlobal && appliedScope !== "global"}
                onClick={() => canToggleGlobal && setScope("global")}
                title={canToggleGlobal ? undefined : "Get a pass to compare against everyone"}
              >
                🌍 Everyone {canToggleGlobal ? "" : "🔒"}
              </button>
            </div>

            {/* Window selector — pass-only. Free/anon tiers have a fixed window
                (24h personal / all-time global), so the selector is hidden. */}
            {canChooseWindow && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#555", width: 48 }}>Window</span>
                <div style={{ display: "flex", gap: 4, flex: 1 }}>
                  {WINDOWS.map((w) => {
                    const active = appliedWindow === w;
                    return (
                      <button
                        key={w}
                        className={`btn${active ? " btn-primary" : ""}`}
                        style={{ flex: 1, padding: "6px 4px" }}
                        onClick={() => setWindow(w)}
                      >
                        {WINDOW_LABEL[w]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {canRefresh && (
              <button
                className="btn w-full"
                disabled={refreshing || statsQuery.isFetching}
                onClick={handleRefresh}
              >
                {refreshing ? "↻ Refreshing…" : "↻ Refresh"}
              </button>
            )}

            {isAuthenticated && (
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
        </div>

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
                {/* ── CRT hero readout ── */}
                <div className="stats-hero">
                  <div className="stats-hero-main">
                    {user?.screenName && (
                      <div className="stats-hero-player">
                        <span className="stats-hero-name">{user.screenName}</span>
                        {(stats.sharkLevel ?? 0) > 0 && (
                          <span className="stats-hero-shark">
                            <span className="stats-hero-shark-emoji" aria-hidden="true">🦈</span> Level {fmtInt(stats.sharkLevel)} Shark
                          </span>
                        )}
                      </div>
                    )}
                    <span className="stats-hero-label">▲ AVG BPM</span>
                    <span className={`stats-hero-value${stats.avgBpm == null ? " dim" : ""}`}>
                      {stats.avgBpm == null ? "--" : stats.avgBpm.toFixed(1)}
                      <span className="stats-hero-unit">BPM</span>
                    </span>
                    <span className="stats-hero-sub">
                      BEST {stats.bestBpm == null ? "--" : stats.bestBpm.toFixed(1)}
                    </span>
                  </div>
                  {stats.bpmTrend.length >= 2 && (
                    <div className="stats-hero-graph">
                      <BpmSparkline data={stats.bpmTrend} />
                      <span className="stats-hero-graph-label">
                        BPM · LAST {stats.bpmTrend.length}
                      </span>
                    </div>
                  )}
                  <div className="stats-hero-side">
                    <div className="stats-hero-side-item">
                      <span className="stats-hero-side-val">{fmtInt(stats.gamesPlayed)}</span>
                      <span className="stats-hero-side-label">GAMES</span>
                    </div>
                    <div className="stats-hero-side-item">
                      <span className="stats-hero-side-val green">{fmtPct(rateValue)}</span>
                      <span className="stats-hero-side-label">{rateLabel}</span>
                    </div>
                    <div className="stats-hero-side-item">
                      <span className="stats-hero-side-val">{stats.accuracy == null ? "--" : `${stats.accuracy}%`}</span>
                      <span className="stats-hero-side-label">AVG ACCURACY</span>
                    </div>
                  </div>
                </div>

                {/* ── Results ── */}
                <div className="panel">
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
                    {(stats.eightBallDecidedGames ?? 0) > 0 && (
                      <PixelMeter
                        label="8-BALL SINK RATE"
                        emoji="🎱"
                        pct={stats.eightBallSinkRate == null ? null : stats.eightBallSinkRate * 100}
                        display={fmtPct(stats.eightBallSinkRate)}
                        tone="amber"
                      />
                    )}
                  </div>
                </div>

                {/* ── Shooting ── */}
                <div className="panel">
                  <SectionHeader emoji="🎯" title="Shooting" />
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <PixelMeter
                      label="ACCURACY"
                      emoji="🎯"
                      pct={stats.accuracy}
                      display={stats.accuracy == null ? "—" : `${stats.accuracy}%`}
                      tone="green"
                    />
                    <PixelMeter
                      label="BEST GAME ACCURACY"
                      emoji="⭐"
                      pct={stats.bestAccuracy}
                      display={stats.bestAccuracy == null ? "—" : `${stats.bestAccuracy}%`}
                      tone="cyan"
                    />
                    {stats.accuracyTrend.length >= 2 && (
                      <div className="stats-trend-box">
                        <BpmSparkline
                          data={stats.accuracyTrend}
                          stroke="#36c5f0"
                          fill="rgba(54, 197, 240, 0.12)"
                          ariaLabel="Accuracy trend over recent games"
                        />
                        <span className="stats-trend-box-label">
                          ACCURACY · LAST {stats.accuracyTrend.length}
                        </span>
                      </div>
                    )}
                    <div className="stats-card-grid">
                      <StatCard emoji="❌" value={fmtInt(stats.totalMisses)} label="MISSES" sub={`${fmtNum(stats.avgMissesPerGame)}/game`} />
                      <StatCard emoji={<span className="cue-ball-icon" style={{ fontSize: 14, verticalAlign: "baseline" }} />} value={fmtInt(stats.totalFouls)} label="FOULS" sub={`${fmtNum(stats.avgFoulsPerGame)}/game`} />
                      <StatCard emoji="🛡️" value={fmtInt(stats.totalSafeties)} label="SAFETIES" sub={`${fmtNum(stats.avgSafetiesPerGame)}/game`} />
                      <StatCard emoji="↩️" value={fmtInt(stats.totalUndos)} label="TIMES NO ONE SAW THAT (UNDOS)" />
                    </div>
                  </div>
                </div>

                {/* ── Pace ── */}
                <div className="panel">
                  <SectionHeader emoji="⚡" title="Pace" />
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div className="digit-display">
                          <div className="digit-bpm">{stats.avgBpm == null ? "--" : stats.avgBpm.toFixed(1)}</div>
                        </div>
                        <div className="digit-label">AVG BPM</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="digit-display">
                          <div className="digit-bpm" style={{ color: "var(--amber)" }}>
                            {stats.bestBpm == null ? "--" : stats.bestBpm.toFixed(1)}
                          </div>
                        </div>
                        <div className="digit-label">BEST BPM</div>
                      </div>
                    </div>
                    {stats.playTimeByType.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>🕐 AVG GAME LENGTH</span>
                        {stats.playTimeByType.map((p) => (
                          <div key={p.gameType} className="stats-bar-line">
                            <div className="stats-bar-top">
                              <span>
                                <span aria-hidden="true" style={{ marginRight: 4 }}>
                                  {GAME_TYPE_EMOJI[p.gameType] ?? "🎱"}
                                </span>
                                {GAME_TYPE_LABEL[p.gameType] ?? p.gameType}
                                <span style={{ color: "#888" }}> · {p.gameCount} {p.gameCount === 1 ? "game" : "games"}</span>
                              </span>
                              <span className="stats-bar-time">{fmtMs(p.avgDurationMs)}</span>
                            </div>
                            <div className="stats-meter-track" style={{ height: 12 }}>
                              <div
                                className="stats-meter-fill amber"
                                style={{ width: `${(p.avgDurationMs / maxPlayMs) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Patterns — personal scope only ── */}
                {isPersonal && (
                  <div className="panel">
                    <SectionHeader emoji="🎱" title="Ball Patterns" />
                    <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {stats.topBalls.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>⭐ MOST-SUNK BALLS</span>
                          {stats.topBalls.map((b) => {
                            const chipClass =
                              b.ball === 8
                                ? "hud-chip-eight"
                                : SOLIDS.includes(b.ball)
                                  ? "hud-chip-solid"
                                  : "hud-chip-stripe";
                            return (
                              <div key={b.ball} className="stats-ball-row">
                                <span
                                  className={`hud-chip ${chipClass}`}
                                  data-number={b.ball}
                                  style={{ "--chip-color": BALL_COLORS[b.ball] } as React.CSSProperties}
                                  aria-label={`Ball ${b.ball}`}
                                />
                                <span className="stats-ball-bar-track">
                                  <span
                                    className="stats-ball-bar-fill"
                                    style={{ width: `${(b.count / maxBallCount) * 100}%`, display: "block" }}
                                  />
                                </span>
                                <span className="stats-ball-count">×{b.count}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
                        🎱 You take {fmtNum(stats.avgShotsPerGame)} shots per game on average
                      </p>

                      {/* Solids vs stripes split */}
                      {((stats.solidsCount ?? 0) > 0 || (stats.stripesCount ?? 0) > 0) && (() => {
                        const solids = stats.solidsCount ?? 0;
                        const stripes = stats.stripesCount ?? 0;
                        const total = solids + stripes;
                        const solidsPct = total > 0 ? (solids / total) * 100 : 0;
                        const stripesPct = total > 0 ? (stripes / total) * 100 : 0;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div className="stats-bar-top">
                              <span>🟡 Solids {Math.round(solidsPct)}%</span>
                              <span>{Math.round(stripesPct)}% Stripes 🔴</span>
                            </div>
                            <div className="stats-split-track">
                              <span className="stats-split-seg solids" style={{ width: `${solidsPct}%` }} />
                              <span className="stats-split-seg stripes" style={{ width: `${stripesPct}%` }} />
                            </div>
                            <div className="stats-bar-top">
                              <span style={{ color: "#888" }}>{solids} games</span>
                              <span style={{ color: "#888" }}>{stripes} games</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Upsell for non-pass tiers ── */}
            {stats.tier !== "pass" && (
              <div className="stats-upsell">
                <p style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>
                  {stats.tier === "public"
                    ? "🔓 Sign in to track your own stats, or get a pass to unlock longer windows, the global leaderboard view, and live refresh."
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
          </>
        )}
      </div>
    </div>
  );
}
