// The ONE reusable Windows-98 styled HUD/result widget. Used on two surfaces:
//   1. end-game "Share" (snapshotted to a PNG via streamWidgetImage.ts)
//   2. the live OBS overlay at /watch/:name?obs=1
// It is purely presentational — all figures come from a prebuilt
// StreamWidgetData (see lib/streamWidget.ts), so both callers render identically.
// Win98 styling is SCOPED to the `.w98-*` class namespace; the rest of the app
// keeps its CRT look.
import { QRCodeSVG } from "qrcode.react";
import { PlayerName } from "./PlayerName";
import SharkIcon from "./SharkIcon";
import { formatTime, SOLIDS, EIGHT_BALL } from "../lib/gameLogic";
import { WIDGET_BALL_COLORS, type StreamWidgetData, type RackBall } from "../lib/streamWidget";

function ballKind(b: number): "eight" | "solid" | "stripe" {
  if (b === EIGHT_BALL) return "eight";
  return SOLIDS.includes(b) ? "solid" : "stripe";
}

/** A single ball token (rack socket or a scoreboard pocketed-ball chip). */
function Ball({ ball, sunk, sunkByShark }: { ball: number; sunk?: boolean; sunkByShark?: boolean }) {
  const kind = ballKind(ball);
  const cls = `w98-ball w98-ball--${kind}${sunk ? " w98-ball--sunk" : ""}`;
  return (
    <span
      className={cls}
      style={{ ["--w98-ball-color" as string]: WIDGET_BALL_COLORS[ball] }}
      title={sunkByShark ? "Sunk by the Shark" : undefined}
      aria-label={`Ball ${ball}${sunk ? " (sunk)" : ""}`}
    >
      <span className="w98-ball-num">{ball}</span>
    </span>
  );
}

function Rack({ data }: { data: StreamWidgetData }) {
  const socket = (rb: RackBall) => (
    <Ball key={rb.ball} ball={rb.ball} sunk={rb.sunk} sunkByShark={rb.sunkByShark} />
  );
  if (data.rackLayout === "line") {
    return <div className="w98-rack-line">{data.rack.map(socket)}</div>;
  }
  const solids = data.rack.filter((r) => SOLIDS.includes(r.ball));
  const stripes = data.rack.filter((r) => r.ball > EIGHT_BALL);
  const eight = data.rack.find((r) => r.ball === EIGHT_BALL);
  return (
    <div className="w98-rack-grouped">
      <div className="w98-rack-side">{solids.map(socket)}</div>
      {eight && <div className="w98-rack-eight">{socket(eight)}</div>}
      <div className="w98-rack-side">{stripes.map(socket)}</div>
    </div>
  );
}

interface Props {
  data: StreamWidgetData;
  /** Show the footer with the watch-handle QR + URL (default for the share image). */
  showQr?: boolean;
  className?: string;
}

/**
 * Render the Win98 scoreboard window. Caller controls layout/scale via a
 * wrapper (the OBS overlay scales it; the export renders it offscreen).
 */
export default function StreamWidget({ data, showQr = false, className }: Props) {
  return (
    <div className={`w98-widget${className ? ` ${className}` : ""}`}>
      <div className="w98-titlebar">
        <span className="w98-titlebar-name">
          <span className="w98-title-glyph" aria-hidden="true">●</span>
          BreakBPM
          {data.handle && <span className="w98-title-handle"> — @{data.handle}</span>}
        </span>
        <span className="w98-titlebar-ctrls" aria-hidden="true">
          <span className="w98-tb-btn">_</span>
          <span className="w98-tb-btn">▢</span>
          <span className="w98-tb-btn">✕</span>
        </span>
      </div>

      <div className="w98-body">
        <div className="w98-heroes">
          <div className="w98-field w98-hero">
            <div className="w98-hero-label">BALLS/MIN</div>
            <div className={`w98-hero-value${data.bpm === null ? " w98-dim" : ""}`}>
              {data.bpm !== null ? data.bpm.toFixed(1) : "--.-"}
            </div>
            <div className="w98-hero-sub">
              {data.bpm === null || !data.bpmSubject ? (
                "AWAITING PLAY"
              ) : (
                <PlayerName name={data.bpmSubject} rainbow={data.bpmSubjectRainbow} upper />
              )}
            </div>
          </div>
          <div className="w98-field w98-hero">
            <div className="w98-hero-label">ACCURACY</div>
            <div className={`w98-hero-value${data.accuracy === null ? " w98-dim" : ""}`}>
              {data.accuracy !== null ? `${data.accuracy}%` : "--%"}
            </div>
            <div className="w98-hero-sub">
              {data.accuracy === null || data.accuracyMade === null
                ? "AWAITING PLAY"
                : `${data.accuracyMade}/${data.accuracyAttempts} MADE`}
            </div>
          </div>
        </div>

        <div className="w98-meta">
          <span className="w98-meta-cell">
            <span className="w98-meta-label">TIME</span>
            <span className="w98-meta-value">{formatTime(data.elapsedMs)}</span>
          </span>
          <span className="w98-meta-cell">
            <span className="w98-meta-label">MODE</span>
            <span className="w98-meta-value">
              {data.modeLabel}
              {data.playerCount > 0 && <span className="w98-meta-dim"> · {data.playerCount}P</span>}
            </span>
          </span>
        </div>

        <div className="w98-field w98-rack">
          <Rack data={data} />
        </div>

        <div className="w98-players">
          {data.players.map((p) => (
            <div
              key={p.id}
              className={`w98-player${p.active ? " w98-player--active" : ""}${p.hasLeft ? " w98-player--left" : ""}`}
            >
              <div className="w98-player-head">
                <span className="w98-player-cue" aria-hidden="true">
                  {p.active ? "●" : ""}
                </span>
                <span className="w98-player-name">
                  {p.isShark && <SharkIcon size={16} />}
                  <PlayerName name={p.name} rainbow={p.rainbow} />
                  {p.isHost && " ★"}
                </span>
                {p.hasLeft && <span className="w98-player-tag">· left</span>}
                {p.teamLabel && (
                  <span className="w98-player-tag">
                    · {p.teamLabel}
                    {p.cleared && " ✓"}
                  </span>
                )}
              </div>
              {p.sunk.length > 0 && (
                <div className="w98-player-balls">
                  {[...p.sunk].reverse().map((b, i) => (
                    <Ball key={i} ball={b} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {data.gameOver && (
          <div className="w98-field w98-winner">
            {data.winnerName ? (
              <span className="w98-winner-text">
                ★ {data.winnerIsShark && <SharkIcon size={20} />}
                <PlayerName name={data.winnerName} rainbow={data.winnerRainbow} upper /> WINS
              </span>
            ) : (
              <span className="w98-winner-text">GAME OVER</span>
            )}
          </div>
        )}

        {showQr && data.watchUrl && (
          <div className="w98-footer">
            <div className="w98-footer-qr">
              <QRCodeSVG value={data.watchUrl} size={84} />
            </div>
            <div className="w98-footer-text">
              <div className="w98-footer-title">WATCH LIVE</div>
              <div className="w98-footer-url">
                {data.handle ? `breakbpm.com/watch/${data.handle}` : data.watchUrl}
              </div>
              <div className="w98-footer-hint">Scan to follow the table</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
