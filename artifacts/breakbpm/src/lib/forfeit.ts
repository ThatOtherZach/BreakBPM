/** Forfeit if no action for this many ms (versus modes only, not practice/shark). */
export const FORFEIT_INACTIVITY_MS = 60 * 60 * 1000; // 60 min

/**
 * Hard wall-clock cap from `gameStartTime`. Applies to ALL game types
 * (including practice and Shark). Mirrors the server-side constant.
 * Prevents reopening a tab and seeing a multi-hour timer.
 */
export const MAX_GAME_DURATION_MS = 60 * 60 * 1000; // 60 min
