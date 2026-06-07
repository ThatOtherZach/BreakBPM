/**
 * Renders a player's name, applying the animated rainbow gradient when that
 * player is an admin. Admin-ness is resolved by the caller from the game-state
 * participants payload (the single source of the per-player `isAdmin` flag) —
 * this component is purely presentational and never knows the admin list.
 *
 * Non-admin names render as a bare text node so existing layout/colors are
 * untouched (no regression). The rainbow span uses `background-clip: text`, so
 * it works over the opaque HUD panel and the transparent OBS overlay alike.
 */
export function PlayerName({
  name,
  admin,
  upper,
}: {
  name: string;
  admin: boolean;
  upper?: boolean;
}) {
  const text = upper ? name.toUpperCase() : name;
  if (!admin) return <>{text}</>;
  return <span className="rainbow-name">{text}</span>;
}
