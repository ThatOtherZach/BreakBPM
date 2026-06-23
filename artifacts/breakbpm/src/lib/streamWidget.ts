// Shared ball-fill palette for the Windows-98 styled chips. Originally part of
// the old offscreen share-widget view-model; the end-game "Share Card" and OBS
// overlay now snapshot/render the real CRT HUD (see GameScreen's renderHudPanel
// + ObsOverlay's W98Frame), so the only piece still shared from here is this
// color map, used by WatchByNameScreen's rack chips.

/** Ball fill colors — mirrors the per-screen BALL_COLORS maps. */
export const WIDGET_BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};
