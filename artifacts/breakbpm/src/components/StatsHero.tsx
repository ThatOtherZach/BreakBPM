import { useLayoutEffect, useRef, useState } from "react";
import type { StatsResult } from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { PlayerName } from "./PlayerName";
import { WinsTodayChip } from "./WinsTodayChip";

export const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};

// Spelled-out form of the applied window, shown under the Shark badge in the hero.
export const WINDOW_SPELLED: Record<string, string> = {
  "24h": "24 Hours",
  "30d": "Last 30 Days",
  "365d": "Last 365 Days",
  all: "All Time",
};

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}
export function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(v);
}

// One drawn series of the overlay: the line path plus a filled area below it.
interface TrendSeriesPaths {
  line: string;
  area: string;
}

/**
 * Build the SVG path strings for a single trend series. Plots only the non-null
 * points (connecting straight across any gaps so a missing game doesn't break
 * the trace) and scales them to this series' own min/max so two series with very
 * different ranges (BPM vs accuracy%) both fill the chart vertically. Returns
 * null when fewer than 2 points exist (can't draw a line). `x` maps a game index
 * onto the shared X axis so both series stay aligned game-for-game.
 */
function buildTrendSeries(
  values: Array<number | null>,
  x: (i: number) => number,
  H: number,
  pad: number,
  step = false,
): TrendSeriesPaths | null {
  const pts: Array<{ i: number; v: number }> = [];
  values.forEach((v, i) => {
    if (v != null) pts.push({ i, v });
  });
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p.v);
  const max = Math.max(...vs);
  const min = Math.min(...vs);
  const span = max - min || 1;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  // `step` draws right-angle segments (horizontal hold, then vertical jump) so
  // the trace reads as a boxy square-wave; otherwise it's a straight diagonal.
  const line = step
    ? pts
        .map((p, k) =>
          k === 0
            ? `M${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`
            : `H${x(p.i).toFixed(1)} V${y(p.v).toFixed(1)}`,
        )
        .join(" ")
    : pts
        .map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
        .join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L${x(last.i).toFixed(1)},${H} L${x(first.i).toFixed(1)},${H} Z`;
  return { line, area };
}

/**
 * Combined BPM + accuracy trend chart. Overlays two edge-to-edge traces over the
 * same per-game X axis — a phosphor-green BPM line and a cyan accuracy line — so
 * a viewer can read "around this game accuracy spiked and so did BPM." Each line
 * keeps its own vertical scaling (BPM and accuracy% have very different ranges)
 * so both stay readable. Thin, smooth, no end dots, matching the CRT look.
 */
export function TrendOverlay({
  data,
}: {
  data: Array<{ bpm: number | null; accuracy: number | null }>;
}) {
  const W = 100;
  const H = 36;
  const pad = 2;
  const n = data.length;
  // Shared X axis: edge-to-edge (no horizontal inset) so both traces touch the
  // left/right borders and line up game-for-game.
  const x = (i: number) => (n === 1 ? W / 2 : (i * W) / (n - 1));
  const bpm = buildTrendSeries(data.map((d) => d.bpm), x, H, pad);
  // Accuracy stays a boxy step trace (matching the original look) so it reads
  // distinctly from the smooth diagonal BPM line.
  const accuracy = buildTrendSeries(data.map((d) => d.accuracy), x, H, pad, true);
  return (
    <svg
      className="stats-hero-spark stats-hero-spark-overlay"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="BPM and accuracy trend over recent games"
    >
      {/* Blue (accuracy) series first, then green (BPM) on top so the green
          line always overlays the blue trace where they cross. */}
      {accuracy && <path d={accuracy.area} fill="rgba(54, 197, 240, 0.12)" stroke="none" />}
      {accuracy && (
        <path
          className="spark-line-cyan"
          d={accuracy.line}
          fill="none"
          stroke="#36c5f0"
          strokeWidth={0.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {bpm && <path d={bpm.area} fill="rgba(0, 255, 65, 0.12)" stroke="none" />}
      {bpm && (
        <path
          className="spark-line-green"
          d={bpm.line}
          fill="none"
          stroke="#00ff41"
          strokeWidth={1.1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * The CRT "hero readout" — the player's headline stats panel shown at the top of
 * the Stats page and (scoped to the last 24h) on a watched player's profile.
 * Driven entirely by a StatsResult; the rate metric follows the result's applied
 * scope (WIN RATE personal, FINISH RATE global) and the window label follows
 * `appliedWindow`. Pass `screenName` to render the player identity block.
 */
export default function StatsHero({
  stats,
  screenName,
  adminName,
  joinedAt,
  backgroundUrl,
}: {
  stats: StatsResult;
  screenName?: string;
  adminName?: boolean;
  joinedAt?: string | null;
  backgroundUrl?: string | null;
}) {
  const isPersonal = stats.appliedScope === "personal";
  const rateLabel = isPersonal ? "WIN RATE" : "FINISH RATE";
  const rateValue = isPersonal ? stats.winRate : stats.finishRate;

  // When a long screen name forces the header to wrap, the AVG-BPM block drops
  // onto its own line — right-aligned, it would hug the edge awkwardly, so we
  // centre it instead. Detection is geometric (is the BPM block on a lower row
  // than the name?) rather than a viewport breakpoint, so it only triggers on
  // an actual wrap. The centring tweak doesn't change the block's width, so it
  // can't feed back into the wrap measurement.
  const playerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [bpmWrapped, setBpmWrapped] = useState(false);
  useLayoutEffect(() => {
    const player = playerRef.current;
    const main = mainRef.current;
    if (!player || !main) return;
    const measure = () => setBpmWrapped(main.offsetTop > player.offsetTop + 1);
    measure();
    const ro = new ResizeObserver(measure);
    const header = player.parentElement;
    if (header) ro.observe(header);
    ro.observe(player);
    ro.observe(main);
    return () => ro.disconnect();
  }, [screenName, stats.gamesPlayed, stats.avgBpm]);

  // Pass-themed artwork sits *behind* this CRT readout: the splash image is the
  // bottom layer, a dark gradient over it keeps the green text legible, and the
  // base scanlines (normally from CSS) are re-declared on top so they survive
  // the inline background-image override. No artwork → undefined → CSS default.
  const heroStyle: React.CSSProperties | undefined = backgroundUrl
    ? {
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.16) 2px, rgba(0,0,0,0.16) 4px), linear-gradient(rgba(8,18,10,0.75), rgba(8,18,10,0.82)), url(${backgroundUrl})`,
        backgroundSize: "auto, auto, cover",
        backgroundPosition: "center, center, center",
        backgroundRepeat: "repeat, no-repeat, no-repeat",
      }
    : undefined;

  if (stats.gamesPlayed === 0) {
    return (
      <div className="stats-hero" style={heroStyle}>
        {screenName && isPersonal && (
          <div className="stats-hero-header">
            <div className="stats-hero-player">
              <div className="stats-hero-name-row">
                <WinsTodayChip winsToday={stats.winsToday ?? 0} />
                <span className="stats-hero-name text-[28px]">
                  <PlayerName name={screenName} admin={adminName ?? false} />
                </span>
              </div>
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: "#aaa", textAlign: "center", margin: "12px 0 0", letterSpacing: "0.1em" }}>No recent games in the last 24 hours :(</p>
        {joinedAt && (
          <p style={{ fontSize: 11, color: "#d8b4ff", textAlign: "center", margin: "8px 0 0" }}>
            Joined: {new Date(joinedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="stats-hero" style={heroStyle}>
      <div className="stats-hero-header">
        {screenName && (
          <div className="stats-hero-player" ref={playerRef}>
            <div className="stats-hero-name-row">
              {isPersonal && (
                <WinsTodayChip winsToday={stats.winsToday ?? 0} />
              )}
              <span className="stats-hero-name text-[28px]">
                {isPersonal
                  ? <PlayerName name={screenName} admin={adminName ?? false} />
                  : "Everyone"}
              </span>
            </div>
            {(stats.sharkLevel ?? 0) > 0 && (
              <span className="stats-hero-shark">
                <span className="stats-hero-shark-emoji" aria-hidden="true">🦈</span> Level {fmtInt(stats.sharkLevel)} Shark
              </span>
            )}
            <span className="stats-hero-window">{fmtInt(stats.gamesPlayed)} Games in {WINDOW_SPELLED[stats.appliedWindow]}</span>
          </div>
        )}
        <div className={`stats-hero-main${bpmWrapped ? " stats-hero-main--wrapped" : ""}`} ref={mainRef}>
          <span className={`stats-hero-value${stats.avgBpm == null ? " dim" : ""}`}>
            {(() => {
              const { avgBpm, globalAvgBpm } = stats;
              const isBelow =
                avgBpm != null && globalAvgBpm != null && avgBpm < globalAvgBpm;
              return (
                <span style={{ color: isBelow ? "#ff4444" : "#00cc44", fontSize: "0.5em", marginRight: 3, textShadow: "none", verticalAlign: "super" }}>
                  {isBelow ? "▼" : "▲"}
                </span>
              );
            })()}
            {stats.avgBpm == null ? (
              "--"
            ) : stats.chaosWinRecent ? (
              <span className="rainbow-name">{stats.avgBpm.toFixed(1)}</span>
            ) : (
              stats.avgBpm.toFixed(1)
            )}
            <span className="stats-hero-unit" style={{ color: "#00ff41" }}>BPM</span>
          </span>
          <span className="stats-hero-sub">
            BEST {stats.bestBpm == null ? "--" : stats.bestBpm.toFixed(1)}
          </span>
        </div>
      </div>
      <div className="stats-hero-row">
        {stats.trend.length >= 2 && (
          <div className="stats-hero-graph">
            <div className="stats-hero-graph-item">
              <TrendOverlay data={stats.trend} />
              <div className="stats-hero-graph-legend">
                <span className="stats-hero-legend-item">
                  <span className="stats-hero-legend-swatch green" aria-hidden="true" /><span style={{ color: "#00ff41" }}>BPM</span>
                </span>
                <span className="stats-hero-legend-item">
                  <span className="stats-hero-legend-swatch cyan" aria-hidden="true" /><span style={{ color: "#36c5f0" }}>ACCURACY</span>
                </span>
                <span className="stats-hero-graph-label" style={{ color: "#00ff41" }}>
                  {(() => {
                    const n = stats.trend.length;
                    const unit =
                      stats.appliedWindow === "24h"
                        ? "GAMES"
                        : stats.appliedWindow === "30d"
                          ? "DAYS"
                          : "MONTHS";
                    return `LAST ${n} ${unit}`;
                  })()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 10 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="stats-hero-side" style={{ paddingTop: 0 }}>
            <div className="stats-hero-side-item">
              <span className="stats-hero-side-val">{fmtInt(stats.gamesPlayed)}</span>
              <span className="stats-hero-side-label" style={{ color: "#fff" }}>GAMES</span>
            </div>
            <div className="stats-hero-side-item">
              <span className="stats-hero-side-val green">{fmtPct(rateValue)}</span>
              <span className="stats-hero-side-label" style={{ color: "#00ff41" }}>{rateLabel}</span>
            </div>
            <div className="stats-hero-side-item">
              <span className="stats-hero-side-val">{stats.accuracy == null ? "--" : `${stats.accuracy}%`}</span>
              <span className="stats-hero-side-label" style={{ color: "#fff" }}>AVG ACCURACY</span>
            </div>
          </div>
          {joinedAt && (
            <p style={{ fontSize: 11, color: "#d8b4ff", textAlign: "center", margin: 0 }}>
              Joined: {new Date(joinedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
        </div>
        {screenName && (
          <a
            href={`/watch/${encodeURIComponent(screenName)}`}
            title={`Watch ${screenName}`}
            style={{ display: "flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}
          >
            <QRCodeSVG
              value={`${window.location.origin}/watch/${encodeURIComponent(screenName)}`}
              size={64}
              bgColor="transparent"
              fgColor="#ffffff"
              level="L"
            />
          </a>
        )}
      </div>
    </div>
  );
}
