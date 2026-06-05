import type { CSSProperties } from "react";
import type { LuckyBreakResult } from "@workspace/api-client-react";

/**
 * The "rolling the rack" reveal. Reuses the in-game pixel-art ball chips
 * (`.hud-chip`) and the retro panel chrome so the moment of suspense feels
 * native to BreakBPM. Two phases:
 *   - "rolling": the rack tumbles while the server settles the seeded draw.
 *   - "result": the won tier lands, with the disclosed odds and a note that
 *     the draw was SEEDED (not biased) by the player's recent shots.
 */

const RACK = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SOLIDS = [1, 2, 3, 4, 5, 6, 7];

// Mirrors BALL_COLORS in GameScreen — kept local so the reveal has no coupling
// to the game engine module.
const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000", 9: "#FDD307",
};

function chipKindClass(b: number): string {
  if (b === 8) return "hud-chip-eight";
  return SOLIDS.includes(b) ? "hud-chip-solid" : "hud-chip-stripe";
}

function chipStyle(b: number, extra?: CSSProperties): CSSProperties {
  return { ["--chip-color" as string]: BALL_COLORS[b], ...extra } as CSSProperties;
}

export default function LuckyBreakReveal({
  phase,
  result,
  onClose,
}: {
  phase: "rolling" | "result";
  result: LuckyBreakResult | null;
  onClose: () => void;
}) {
  const isJackpot = result?.outcome === "lifetime";
  const resultBall = isJackpot ? 8 : 1;
  const oddsPct = result ? Math.round(result.lifetimeProbability * 100) : 20;

  return (
    <div className="lb-overlay" role="dialog" aria-modal="true" aria-label="Lucky Break result">
      <div className="panel lb-card">
        <div className="panel-header">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span aria-hidden="true">🎱</span>Lucky Break
          </span>
        </div>
        <div className="panel-body lb-body">
          {phase === "rolling" && (
            <>
              <div className="lb-headline lb-blink">ROLLING THE RACK…</div>
              <div className="lb-rack" aria-hidden="true">
                {RACK.map((b, i) => (
                  <span
                    key={b}
                    className={`hud-chip ${chipKindClass(b)} lb-chip-roll`}
                    data-number={b}
                    style={chipStyle(b, { animationDelay: `${i * 0.07}s` })}
                  />
                ))}
              </div>
              <div className="lb-subtle">Settling the seeded draw…</div>
            </>
          )}

          {phase === "result" && result && (
            <>
              <div className={`lb-result-stage${isJackpot ? " lb-jackpot" : ""}`}>
                <span
                  className={`hud-chip ${chipKindClass(resultBall)} lb-result-chip lb-pop`}
                  data-number={resultBall}
                  style={chipStyle(resultBall)}
                />
              </div>
              <div className="lb-headline">{isJackpot ? "JACKPOT!" : "NICE BREAK!"}</div>
              <div className={`lb-tier${isJackpot ? " lb-tier-gold" : ""}`}>
                {isJackpot ? "LIFETIME PASS" : "MONTHLY PASS"}
              </div>
              <p className="lb-desc">
                {isJackpot
                  ? "You beat the odds — full access, forever."
                  : "Full access for 30 days is now unlocked. Enjoy the run!"}
              </p>
              <div className="lb-odds">
                Lifetime odds were <strong>{oddsPct}%</strong> · every roll guarantees at
                least Monthly.
              </div>
              <div className="lb-seed">
                Seeded by {result.seededShotCount ?? 0} shots across BreakBPM from
                the last {result.windowDays} days.
                {result.seedHash && (
                  <>
                    <br />
                    <span className="lb-seed-hash">seed {result.seedHash.slice(0, 16)}…</span>
                  </>
                )}
              </div>
              <button className="btn btn-primary btn-big w-full" onClick={onClose}>
                Continue
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
