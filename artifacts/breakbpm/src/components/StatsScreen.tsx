import { useState } from "react";
import {
  useGetStats,
  getStats,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import type { GetStatsParams, StatsResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import { SOLIDS } from "../lib/gameLogic";

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
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

/** A single metric tile — big VT323 value over a small caption. */
function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 calc(50% - 6px)",
        minWidth: 120,
        background: "#fff",
        border: "1px solid #999",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>{label}</span>
      <span
        style={{
          fontFamily: "VT323",
          fontSize: 28,
          lineHeight: 1,
          color: accent ?? "#000080",
        }}
      >
        {value}
      </span>
      {sub && <span style={{ fontSize: 10, color: "#777" }}>{sub}</span>}
    </div>
  );
}

function TileRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>;
}

export default function StatsScreen({ onBack, onAbout, onAccount, onSignIn }: Props) {
  const qc = useQueryClient();
  const [window, setWindow] = useState<"24h" | "30d" | "365d" | "all">("24h");
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [refreshing, setRefreshing] = useState(false);

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
  const appliedScope = stats?.appliedScope ?? "personal";
  const appliedWindow = stats?.appliedWindow ?? "24h";
  const isPersonal = appliedScope === "personal";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      <div className="app-body">
        {/* Controls */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>📊</span>Statistics
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
                Me
              </button>
              <button
                className={`btn${appliedScope === "global" ? " btn-primary" : ""}`}
                style={{ flex: 1 }}
                disabled={!canToggleGlobal && appliedScope !== "global"}
                onClick={() => canToggleGlobal && setScope("global")}
                title={canToggleGlobal ? undefined : "Get a pass to compare against everyone"}
              >
                Everyone {canToggleGlobal ? "" : "🔒"}
              </button>
            </div>

            {/* Window selector */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#555", width: 48 }}>Window</span>
              <div style={{ display: "flex", gap: 4, flex: 1 }}>
                {WINDOWS.map((w) => {
                  const active = appliedWindow === w;
                  const locked = !canChooseWindow && w !== "24h";
                  return (
                    <button
                      key={w}
                      className={`btn${active ? " btn-primary" : ""}`}
                      style={{ flex: 1, padding: "6px 4px", opacity: locked ? 0.5 : 1 }}
                      disabled={locked}
                      onClick={() => canChooseWindow && setWindow(w)}
                      title={locked ? "Get a pass to unlock longer windows" : undefined}
                    >
                      {WINDOW_LABEL[w]}
                    </button>
                  );
                })}
              </div>
            </div>

            {canRefresh && (
              <button
                className="btn w-full"
                disabled={refreshing || statsQuery.isFetching}
                onClick={handleRefresh}
              >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
            )}
          </div>
        </div>

        {statsQuery.isLoading && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>Loading…</p>
            </div>
          </div>
        )}

        {statsQuery.isError && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontSize: 12, color: "#c00" }}>Couldn't load stats. Try again shortly.</p>
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
                      ? "No completed games in this window yet. Go sink some balls!"
                      : "No completed games in this window yet."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Results */}
                <div className="panel">
                  <div className="panel-header"><span>Results</span></div>
                  <div className="panel-body">
                    <TileRow>
                      <Tile label="GAMES PLAYED" value={fmtInt(stats.gamesPlayed)} />
                      {isPersonal ? (
                        <Tile label="WIN RATE" value={fmtPct(stats.winRate)} accent="#006400" />
                      ) : (
                        <Tile
                          label="FINISH RATE"
                          value={fmtPct(stats.finishRate)}
                          accent="#006400"
                          sub="games played to the end"
                        />
                      )}
                      <Tile
                        label="8-BALL SINK RATE"
                        value={fmtPct(stats.eightBallSinkRate)}
                        sub={`${fmtInt(stats.eightBallDecidedGames)} decided on the 8`}
                      />
                    </TileRow>
                  </div>
                </div>

                {/* Shooting */}
                <div className="panel">
                  <div className="panel-header"><span>Shooting</span></div>
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <TileRow>
                      <Tile
                        label="ACCURACY"
                        value={stats.accuracy == null ? "—" : `${stats.accuracy}%`}
                        accent="#006400"
                      />
                      <Tile
                        label="BEST ACCURACY"
                        value={stats.bestAccuracy == null ? "—" : `${stats.bestAccuracy}%`}
                      />
                    </TileRow>
                    <TileRow>
                      <Tile label="TOTAL SHOTS" value={fmtInt(stats.totalShots)} sub={`${fmtNum(stats.avgShotsPerGame)}/game`} />
                      <Tile label="MISSES" value={fmtInt(stats.totalMisses)} sub={`${fmtNum(stats.avgMissesPerGame)}/game`} />
                      <Tile label="FOULS" value={fmtInt(stats.totalFouls)} sub={`${fmtNum(stats.avgFoulsPerGame)}/game`} />
                      <Tile label="SAFETIES" value={fmtInt(stats.totalSafeties)} sub={`${fmtNum(stats.avgSafetiesPerGame)}/game`} />
                      <Tile label="UNDOS" value={fmtInt(stats.totalUndos)} />
                    </TileRow>
                  </div>
                </div>

                {/* Pace */}
                <div className="panel">
                  <div className="panel-header"><span>Pace</span></div>
                  <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <TileRow>
                      <Tile label="AVG BPM" value={stats.avgBpm == null ? "—" : stats.avgBpm.toFixed(1)} />
                      <Tile label="BEST BPM" value={stats.bestBpm == null ? "—" : stats.bestBpm.toFixed(1)} />
                    </TileRow>
                    {stats.playTimeByType.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>AVG GAME LENGTH</span>
                        {stats.playTimeByType.map((p) => (
                          <div
                            key={p.gameType}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              borderTop: "1px solid #ddd",
                              padding: "3px 0",
                            }}
                          >
                            <span>{GAME_TYPE_LABEL[p.gameType] ?? p.gameType}</span>
                            <span style={{ color: "#444" }}>
                              🕐 {fmtMs(p.avgDurationMs)} · {p.gameCount} {p.gameCount === 1 ? "game" : "games"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Patterns — personal scope only */}
                {isPersonal && (
                  <div className="panel">
                    <div className="panel-header"><span>Ball Patterns</span></div>
                    <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {stats.topBalls.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ fontSize: 10, color: "#555", letterSpacing: 0.5 }}>MOST-SUNK BALLS</span>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            {stats.topBalls.map((b) => {
                              const chipClass =
                                b.ball === 8
                                  ? "hud-chip-eight"
                                  : SOLIDS.includes(b.ball)
                                    ? "hud-chip-solid"
                                    : "hud-chip-stripe";
                              return (
                                <span key={b.ball} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <span
                                    className={`hud-chip ${chipClass}`}
                                    data-number={b.ball}
                                    style={{ "--chip-color": BALL_COLORS[b.ball] } as React.CSSProperties}
                                    aria-label={`Ball ${b.ball}`}
                                  />
                                  <span style={{ fontFamily: "VT323", fontSize: 20, color: "#000080" }}>×{b.count}</span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <TileRow>
                        <Tile label="SOLIDS GAMES" value={fmtInt(stats.solidsCount)} />
                        <Tile label="STRIPES GAMES" value={fmtInt(stats.stripesCount)} />
                      </TileRow>
                      {(stats.sharkGames ?? 0) > 0 && (
                        <TileRow>
                          <Tile
                            label="🦈 SHARK WIN RATE"
                            value={fmtPct(stats.sharkWinRate)}
                            sub={`${fmtInt(stats.sharkGames)} shark games`}
                          />
                        </TileRow>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Upsell for non-pass tiers */}
            {stats.tier !== "pass" && (
              <div className="panel">
                <div className="panel-body">
                  <p style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>
                    {stats.tier === "public"
                      ? "Sign in to track your own stats, or get a pass to unlock longer windows, the global leaderboard view, and live refresh."
                      : "Get a pass to unlock 30-day, 1-year and all-time windows, the global comparison view, and manual refresh."}
                  </p>
                  <button
                    className="btn btn-primary w-full"
                    onClick={stats.tier === "public" ? onSignIn : onAccount}
                  >
                    {stats.tier === "public" ? "Sign In" : "Get a Pass"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
