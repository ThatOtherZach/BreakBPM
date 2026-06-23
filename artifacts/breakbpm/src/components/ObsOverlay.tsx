import { useEffect, type ReactNode } from 'react';

/**
 * OBS overlay primitives. The overlay variant of /watch/:name renders a
 * chrome-free, transparent HUD intended to be dropped into OBS as a Browser
 * Source so the live scoreboard composites over a billiards stream.
 */

/** Clamp a parsed `?scale=` value to a sane CSS transform range. */
export function clampObsScale(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(5, Math.max(0.2, raw));
}

/**
 * Toggle a `obs-mode` class on <html>/<body> while the overlay is mounted so
 * the page canvas goes transparent (OBS composites the feed behind it). The
 * normal app keeps its teal desktop background.
 */
export function useObsBodyClass(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('obs-mode');
    body.classList.add('obs-mode');
    return () => {
      html.classList.remove('obs-mode');
      body.classList.remove('obs-mode');
    };
  }, [active]);
}

/**
 * The idle face shown whenever there is nothing live to display in overlay
 * mode: no active game, host without an active paid pass, ended game, or an
 * unresolved player name. Deliberately just `:(` so the stream never shows an
 * error card, Back button, or sign-in UI.
 */
export function ObsIdle({ scale = 1 }: { scale?: number }) {
  return (
    <div
      className="obs-overlay obs-idle"
      style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
    >
      <span className="obs-idle-face">:(</span>
    </div>
  );
}

/**
 * Win98 window-chrome wrapper. Renders the BreakBPM title bar (with an
 * optional @handle and the classic minimize/maximize/close decorations) and a
 * padded body container, then renders `children` inside that body. This lets
 * the OBS overlay host the real CRT HUD inside the Win98 frame without
 * duplicating layout or content.
 *
 * To keep the whole window reading as the host's themed surface (matching the
 * felt inside the HUD), the title bar tints to the host's `accent` when one is
 * supplied, and the @handle renders with the animated rainbow gradient when
 * the host carries a `rainbow` name — same treatment they get inside the HUD.
 */
export function W98Frame({
  handle,
  rainbow = false,
  accent,
  children,
}: {
  handle?: string | null;
  /** Paint the @handle with the rainbow gradient (host has a rainbow name). */
  rainbow?: boolean;
  /** Host theme accent (e.g. #3ba7ff). Null/undefined keeps the classic blue. */
  accent?: string | null;
  children: ReactNode;
}) {
  const titleStyle = accent
    ? { background: `linear-gradient(to right, var(--navy) 0%, ${accent} 100%)` }
    : undefined;
  return (
    <div className="w98-widget">
      <div className="w98-titlebar" style={titleStyle}>
        <span className="w98-titlebar-name">
          <span className="w98-title-glyph" aria-hidden="true">●</span>
          BreakBPM
          {handle && (
            <span className="w98-title-handle">
              {' — @'}
              {rainbow ? <span className="rainbow-name">{handle}</span> : handle}
            </span>
          )}
        </span>
        <span className="w98-titlebar-ctrls" aria-hidden="true">
          <span className="w98-tb-btn">_</span>
          <span className="w98-tb-btn">▢</span>
          <span className="w98-tb-btn">✕</span>
        </span>
      </div>
      <div className="w98-body">
        {children}
      </div>
    </div>
  );
}
