import type React from "react";

const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};
const SOLIDS = [1, 2, 3, 4, 5, 6, 7];

function winLabel(n: number) {
  return `${n} 8-Ball Win${n !== 1 ? "s" : ""} Today`;
}

/**
 * Wins-today ball chip — shows how many standard 8-ball games the player won
 * in the last 24 hours, rendered as a billiard ball whose number IS the win
 * count.
 *
 *   0 wins   → plain white cue ball  (.cue-ball-icon--chip)
 *   1–15     → numbered ball chip    (solid 1–7, 8-ball for 8, stripe 9–15)
 *   16+      → spinning rainbow cue  (.rainbow-cue scaled to chip size)
 *
 * Pass `small` to render at ~85% size (22px instead of 26px), for use next
 * to smaller labels like the shark count.
 */
export function WinsTodayChip({ winsToday, small }: { winsToday: number; small?: boolean }): React.ReactElement {
  const chipSize = small ? "22px" : "26px";
  const iconSize = small ? 22 : 26;
  const label = winLabel(winsToday);

  if (winsToday <= 0) {
    return (
      <span
        className="cue-ball-icon cue-ball-icon--chip"
        style={{ "--chip-size": chipSize } as React.CSSProperties}
        aria-label={label}
        title={label}
      />
    );
  }

  if (winsToday > 15) {
    return (
      <span
        className="rainbow-cue"
        style={{ fontSize: iconSize, verticalAlign: "baseline" }}
        aria-label={label}
        title={label}
      />
    );
  }

  const ball = winsToday;
  const chipClass =
    ball === 8
      ? "hud-chip-eight"
      : SOLIDS.includes(ball)
        ? "hud-chip-solid"
        : "hud-chip-stripe";

  return (
    <span
      className={`hud-chip ${chipClass}`}
      data-number={ball}
      style={{ "--chip-color": BALL_COLORS[ball], "--chip-size": chipSize } as React.CSSProperties}
      aria-label={label}
      title={label}
    />
  );
}
