/**
 * Renders a player's name, applying the animated rainbow gradient when the
 * `rainbow` flag is set. Rainbow-ness is resolved by the caller from the
 * server (admins, or active pass holders who picked the "rainbow" theme) —
 * this component is purely presentational and never knows that policy.
 *
 * Plain names render as a bare text node so existing layout/colors are
 * untouched (no regression). The rainbow span uses `background-clip: text`, so
 * it works over the opaque HUD panel and the transparent OBS overlay alike.
 */
export function PlayerName({
  name,
  rainbow,
  upper,
}: {
  name: string;
  rainbow: boolean;
  upper?: boolean;
}) {
  const text = upper ? name.toUpperCase() : name;
  if (!rainbow) return <>{text}</>;
  return <span className="rainbow-name">{text}</span>;
}
