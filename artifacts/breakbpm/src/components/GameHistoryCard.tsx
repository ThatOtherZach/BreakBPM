import { useLocation } from "wouter";
import type { GameHistoryEntry } from "@workspace/api-client-react";
import SharkIcon from "./SharkIcon";
import { SHARK_PLAYER_NAME, SOLIDS } from "../lib/gameLogic";
import { THEME_FELT, themeColorOf } from "../lib/backgroundVariants";

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
 * A single, non-wrapping line of the balls pocketed during a game, in the
 * exact order they were sunk. Balls are grouped into consecutive same-shooter
 * runs only to add a subtle gap at turn changes and to mark Shark steals with
 * the shark fin — no player names are shown. Scrolls horizontally when wider
 * than the row.
 */
function ShotLogRow({ seq }: { seq: PocketEvent[] }) {
  const runs = toRuns(seq);
  return (
    <div className="shotlog-row">
      <div className="shotlog-scroll">
        {runs.map((run, ri) => {
          // In Shark-mode games the invisible Shark's pocketed balls are dimmed
          // (its fin icon is left bright) so the human player's own balls stand
          // out. No other game type dims anything.
          const isShark = run.player === SHARK_PLAYER_NAME;
          return (
            <span
              key={ri}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                marginLeft: ri > 0 ? 5 : 0,
                flexShrink: 0,
              }}
            >
              {isShark && <SharkIcon size={13} />}
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
                    className={`hud-chip hud-chip-sm ${chipClass}${
                      isShark ? " shotlog-chip--shark" : ""
                    }`}
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

export function fmtMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  const dd = date.getDate().toString().padStart(2, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

const GAME_TYPE_LABEL: Record<string, string> = {
  "8ball": "8-Ball",
  "9ball": "9-Ball",
  practice: "Practice",
};

type OutcomeStyle = { label: string; bg: string; fg: string; border: string; title?: string };
const OUTCOME_STYLE: Record<string, OutcomeStyle> = {
  won: { label: "WIN", bg: "#c9a000", fg: "#1a0800", border: "#7a5f00" },
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

// A None game ("free shoot-around", no winner) that finished normally (table
// cleared / completed) gets its own teal CLEARED badge — distinct from
// Practice's silver DONE. A None game force-ended by the time cap or
// inactivity sweep is NOT "cleared", so it falls through to the standard
// outcome badge (same as a capped Practice session) instead.
const CLEARED_STYLE: OutcomeStyle = {
  label: "CLEARED",
  bg: "#0a3d62",
  fg: "#7fdbff",
  border: "#1b6ca8",
  title: "Free shoot-around — table cleared, no winner",
};

function ResultBadge({ outcome, chaosMode }: { outcome: string; chaosMode?: string | null }) {
  const isNone = chaosMode === "none" && outcome === "completed";
  const isChaos =
    (chaosMode === "eight-last" || chaosMode === "anything-goes") &&
    (outcome === "won" || outcome === "lost");
  const s = isNone ? CLEARED_STYLE : OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.completed;
  return (
    <span
      title={isChaos ? "Chaos game" : s.title}
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: "bold",
        letterSpacing: 0.5,
        padding: "1px 6px",
        background: isChaos ? "#1a1020" : s.bg,
        color: isChaos ? undefined : s.fg,
        border: `1px solid ${isChaos ? "#6a3fa0" : s.border}`,
      }}
    >
      {/* Chaos games animate the WIN/LOSS verdict through the same panning
          rainbow as the AVG-BPM hero (.rainbow-name) so the two stay in sync. */}
      {isChaos ? <span className="rainbow-name">{s.label}</span> : s.label}
    </span>
  );
}

/**
 * One game's history row — mode, result/winner, BPM + accuracy hero, duration
 * and date, plus the visual shot-log of balls in pocket order. Shared between
 * the owner's account page and the public /watch/{name} profile so both stay
 * pixel-identical.
 */
export default function GameHistoryCard({
  game: g,
  hideOpponent = false,
}: {
  game: GameHistoryEntry;
  /** Redact the opponent's name (e.g. on the public watch page for signed-out
   *  visitors). Shark games are unaffected — they show no real player name. */
  hideOpponent?: boolean;
}) {
  const [, setLocation] = useLocation();
  const modeLabel = GAME_TYPE_LABEL[g.gameType] ?? g.gameType;
  const hasBpm = g.bpm != null;
  const hasAcc = g.accuracy != null;
  // Tint the card's pool-table felt to THIS game's HOST theme (server-resolved
  // `hostTheme`), so every viewer sees the host's table — not their own theme.
  // No host theme → green (the default felt). Mirrors the leaderboard card felt.
  const felt = THEME_FELT[themeColorOf(g.hostTheme)];
  // Shark verdict: only render a decisive result. A Shark win sets `winner` to
  // the literal Shark name; a player win is the subject-relative "won" outcome.
  // An unfinished Shark game (DNF — forfeit / 60-min cap / inactivity sweep) has
  // no winner, so it shows no verdict at all (the ResultBadge already reads
  // "DNF") rather than falsely claiming the player "Beat the Shark".
  const sharkVerdict =
    g.winner === SHARK_PLAYER_NAME
      ? "Shark'd"
      : g.outcome === "won"
        ? "Beat The Shark"
        : null;
  return (
    <div
      className="fpp-card history-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        backgroundColor: felt.felt,
        boxShadow: `inset 0 0 0 2px ${felt.feltShadow}, inset 0 2px 6px rgba(0, 0, 0, 0.35)`,
        "--felt": felt.felt,
        "--felt-fade": felt.feltFade,
      } as React.CSSProperties}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Left: mode + result + winner */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 20,
              lineHeight: 1,
              letterSpacing: 0.5,
              color: "#f4f4dc",
              textShadow: "1px 1px 0 #042414",
            }}
          >
            {modeLabel}
          </span>
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 14,
              lineHeight: 1,
              letterSpacing: 0.5,
              color: "#8aa593",
            }}
          >
            {g.group === "solids"
              ? "(Solids)"
              : g.group === "stripes"
                ? "(Stripes)"
                : g.sharkMode
                  ? "(Shark)"
                  : `(${modeLabel})`}
          </span>
          {(() => {
            // A finished game is tagged to a Verified Hall (venue) OR — when no
            // hall was in range — to a city locality. Render whichever applies
            // as a #LINK to its leaderboard (hall board vs. city board).
            const tag = g.venue
              ? {
                  label: g.venue.name,
                  href: `/leaderboard/hall/${g.venue.slug ?? g.venue.id}`,
                  title: `Local Leaderboard · ${g.venue.name}`,
                }
              : g.cityLocality
                ? {
                    label: g.cityLocality,
                    href: `/leaderboard/city/${encodeURIComponent(g.cityLocality)}`,
                    title: `City Leaderboard · ${g.cityLocality}`,
                  }
                : null;
            return tag ? (
              <button
                type="button"
                onClick={() => setLocation(tag.href)}
                title={tag.title}
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "#ffe9a8",
                  fontSize: 11,
                  lineHeight: 1.2,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textDecoration: "underline",
                }}
              >
                #{tag.label}
              </button>
            ) : null;
          })()}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#cdeccd", fontSize: 11 }}>
            <ResultBadge outcome={g.outcome} chaosMode={g.chaosMode} />
            {g.sharkMode ? (
              sharkVerdict ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                  <SharkIcon size={12} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sharkVerdict}
                  </span>
                </span>
              ) : null
            ) : g.opponent ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {"vs. "}
                  {hideOpponent ? (
                    "🕴️"
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLocation(`/watch/${encodeURIComponent(g.opponent!)}`)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "inherit",
                        fontSize: "inherit",
                        fontFamily: "inherit",
                        lineHeight: "inherit",
                        textDecoration: "underline",
                      }}
                    >
                      @{g.opponent}
                    </button>
                  )}
                </span>
              </span>
            ) : null}
          </span>
          {g.endReason && (
            <span style={{ fontSize: 10, color: "#a9c9b3", fontStyle: "italic" }}>
              {g.endReason === "max_duration_60min"
                ? "Ended — 60 min cap reached"
                : "Ended — inactive for 60 min"}
            </span>
          )}
          {/* Date stays left-aligned under the badge; duration moved to the
              right column under accuracy. */}
          <span style={{ fontSize: 10, color: "#a9c9b3" }}>
            {fmtDate(g.endedAt)}
          </span>
        </div>

        {/* Right: BPM hero + acc + duration */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 26,
              lineHeight: 1,
              color: hasBpm ? "#ffe98a" : "#8aa593",
              textShadow: "1px 1px 0 #042414",
            }}
          >
            {hasBpm ? `${g.bpm!.toFixed(1)} BPM` : "— BPM"}
          </span>
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 18,
              lineHeight: 1,
              color: hasAcc ? "#b9e6c4" : "#8aa593",
              textShadow: "1px 1px 0 #042414",
            }}
          >
            {hasAcc ? `${g.accuracy}% ACC` : "—% ACC"}
          </span>
          <span style={{ fontSize: 10, color: "#a9c9b3" }}>
            🕐 {fmtMs(g.durationMs)}
          </span>
        </div>
      </div>

      {/* Bottom: visual shot log — balls in pocket order */}
      {g.pocketSequence && g.pocketSequence.length > 0 && (
        <ShotLogRow seq={g.pocketSequence} />
      )}
    </div>
  );
}
