import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  useGetLeaderboard,
  useGetHallLeaderboard,
  getGetLeaderboardQueryKey,
  getGetHallLeaderboardQueryKey,
  useGetMe,
} from "@workspace/api-client-react";
import type { LeaderboardRow, GetLeaderboardWindow, GetLeaderboardMode } from "@workspace/api-client-react";
import Navbar from "./Navbar";
import { useAuth } from "../lib/authClient";
import { THEME_FELT, themeColorOf } from "../lib/backgroundVariants";
import { WinsTodayChip } from "./WinsTodayChip";
import { PlayerName } from "./PlayerName";
import { venueWebsiteUrl } from "./FindPlayersScreen";
import { venuePaymentBadge } from "../lib/venuePaymentType";

const PAGE_SIZE = 50;
const WIDGET_SIZE = 10;

const WINDOW_LABEL: Record<GetLeaderboardWindow, string> = {
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
};
const WINDOWS: GetLeaderboardWindow[] = ["30d", "90d", "all"];

const MODE_LABEL: Record<GetLeaderboardMode, string> = {
  "8ball": "8-BALL",
  "9ball": "9-BALL",
};
const MODE_LABEL_PROSE: Record<GetLeaderboardMode, string> = {
  "8ball": "8-Ball",
  "9ball": "9-Ball",
};
const MODES: GetLeaderboardMode[] = ["8ball", "9ball"];

function rankBadge(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

/**
 * One leaderboard standing, styled to match the Recent Games history cards
 * (`fpp-card history-card`): rank on the left, name in the middle, the
 * BPM / accuracy hero on the right, and a "Who?" jump to the player's live
 * profile.
 */
export function LeaderboardRowCard({
  row,
  onWho,
}: {
  row: LeaderboardRow;
  onWho?: (name: string) => void;
}) {
  // Tint the whole card's pool-table felt to the player's profile theme
  // (shark→blue, hustler→red, pool-player→purple, else green) so each
  // standing reads as that player's own table — same felt palette as the HUD.
  // Overriding only the base color + inner rail leaves the .fpp-card crosshatch
  // weave (rgba overlays) and the wooden outset rail intact for every theme.
  const felt = THEME_FELT[themeColorOf(row.profileBackground)];
  return (
    <div
      className="fpp-card history-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        backgroundColor: felt.felt,
        boxShadow: `inset 0 0 0 2px ${felt.feltShadow}, inset 0 2px 6px rgba(0, 0, 0, 0.35)`,
      }}
    >
      <span
        style={{
          fontFamily: "VT323",
          fontSize: 22,
          lineHeight: 1,
          color: "#ffe98a",
          textShadow: "1px 1px 0 #042414",
          minWidth: 36,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {rankBadge(row.rank)}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span
            className="felt-name"
            style={{
              fontFamily: "VT323",
              fontSize: 20,
              lineHeight: 1,
              color: "#f4f4dc",
              textShadow: "1px 1px 0 #042414",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <PlayerName name={row.screenName} rainbow={row.rainbowName ?? false} />
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <WinsTodayChip winsToday={row.winsToday ?? 0} small />
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 16,
              lineHeight: 1,
              color: "#ffe98a",
              textShadow: "1px 1px 0 #042414",
            }}
          >
            {row.bpm.toFixed(1)} BPM
          </span>
          <span
            style={{
              fontFamily: "VT323",
              fontSize: 16,
              lineHeight: 1,
              color: row.accuracy != null ? "#b9e6c4" : "#8aa593",
              textShadow: "1px 1px 0 #042414",
            }}
          >
            {row.accuracy != null ? `${row.accuracy}% ACC` : "—% ACC"}
          </span>
          {row.sharkLevel != null && row.sharkLevel > 0 && (
            <span
              style={{
                fontFamily: "VT323",
                fontSize: 16,
                lineHeight: 1,
                color: "#9fc6ff",
                textShadow: "1px 1px 0 #042414",
              }}
              className="font-normal">
              🦈{row.sharkLevel}
            </span>
          )}
        </div>
      </div>
      {onWho && (
        <button className="btn" style={{ flexShrink: 0 }} onClick={() => onWho(row.screenName)}>🔎</button>
      )}
    </div>
  );
}

/**
 * Compact top-10 (30-day) leaderboard for the main menu. Visible to everyone,
 * including signed-out visitors. Hidden entirely while loading or when there's
 * nothing to show, so it never clutters the home screen. "Everyone Else" opens
 * the full leaderboard page.
 */
export function LeaderboardWidget() {
  const [, setLocation] = useLocation();
  const q = useGetLeaderboard({ window: "30d", page: 1, pageSize: WIDGET_SIZE });
  const rows = q.data?.rows ?? [];

  if (q.isLoading || q.isError || rows.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-header">
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          className="text-[13px] font-semibold text-[#ffffff]"
        >
          🏆 LEADERBOARD · 30 DAYS
        </span>
      </div>
      <div className="panel-body panel--wood" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((row) => (
          <LeaderboardRowCard
            key={row.screenName}
            row={row}
            onWho={(name) => setLocation(`/watch/${encodeURIComponent(name)}`)}
          />
        ))}
        <button
          className="btn w-full"
          style={{ marginTop: 6 }}
          onClick={() => setLocation("/leaderboard")}
        >Everyone • 所有人 →</button>
      </div>
    </div>
  );
}

interface Props {
  onBack: () => void;
  onManual: () => void;
  onAccount: () => void;
  onFindPlayers: () => void;
  onStats: () => void;
  onSignIn: () => void;
  /**
   * When set, this is a per-hall ("Local") leaderboard scoped to a single
   * Verified Hall: the same ranking, but only counting games tagged to this
   * venue. The 30d window is public (signed-out visitors can view it and get a
   * sign-up nudge); longer windows are still a pass perk.
   */
  venueId?: string;
}

/**
 * Full leaderboard page. 50 standings per page with a 30d / 90d / all-time
 * window toggle — the longer windows are a pass perk (also enforced
 * server-side). The GLOBAL board requires sign-in to view; a per-hall board
 * (`venueId` set) is public for the 30d window, reusing the same
 * ranking/pagination UI.
 */
export default function LeaderboardScreen({
  onBack,
  onManual,
  onAccount,
  onFindPlayers,
  onStats,
  onSignIn,
  venueId,
}: Props) {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const me = useGetMe();
  const isPass = me.data?.entitlement?.tier === "pass";
  const isHall = venueId != null;

  const [mode, setMode] = useState<GetLeaderboardMode>("8ball");
  const [window, setWindow] = useState<GetLeaderboardWindow>("30d");
  const [page, setPage] = useState(1);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkCopyFailed, setLinkCopyFailed] = useState(false);


  // Two queries, mutually gated by `enabled`. The GLOBAL query always runs (the
  // default 30d window is public, so an anonymous fetch never 403s) but its
  // result is only rendered for signed-in callers. The HALL query needs sign-in
  // for every window, so it's gated on auth too. Per the generated-hook
  // contract, passing any `query` option makes `queryKey` required.
  const globalQ = useGetLeaderboard(
    { mode, window, page, pageSize: PAGE_SIZE },
    {
      query: {
        enabled: !isHall,
        queryKey: getGetLeaderboardQueryKey({ mode, window, page, pageSize: PAGE_SIZE }),
      },
    },
  );
  // The 30d window is public, so signed-out visitors can view a hall's recent
  // standings (and get a sign-up nudge). Longer windows still need a pass, but a
  // non-pass caller can never switch to them, so the 30d gate is sufficient here.
  const hallQ = useGetHallLeaderboard(
    { venueId: venueId ?? "", mode, window, page, pageSize: PAGE_SIZE },
    {
      query: {
        enabled: isHall && (isAuthenticated || window === "30d"),
        queryKey: getGetHallLeaderboardQueryKey({ venueId: venueId ?? "", mode, window, page, pageSize: PAGE_SIZE }),
      },
    },
  );
  const q = isHall ? hallQ : globalQ;
  const data = q.data;
  const rows = data?.rows ?? [];
  const hallVenue = hallQ.data?.venue;

  // Cosmetic: when a hall was opened via a legacy id (or an un-slugged hall that
  // just self-healed), swap the address bar to the readable slug, so the
  // shown/copied URL is the nice one. A replace (not push) keeps the back button
  // sane, and routing through wouter keeps the artifact base path intact. Old id
  // links keep working because the server resolves either form.
  useEffect(() => {
    const slug = hallVenue?.slug;
    if (!isHall || !slug || slug === venueId) return;
    setLocation(`/leaderboard/hall/${encodeURIComponent(slug)}`, { replace: true });
  }, [isHall, venueId, hallVenue?.slug, setLocation]);

  function chooseWindow(w: GetLeaderboardWindow) {
    if (w !== "30d" && !isPass) return;
    setWindow(w);
    setPage(1);
  }

  function chooseMode(m: GetLeaderboardMode) {
    setMode(m);
    setPage(1);
  }

  return (
    <div className="app-window app-window--page">
      <Navbar
        onBack={onBack}
        onManual={onManual}
        onAccount={onAccount}
        onFindPlayers={onFindPlayers}
        onStats={onStats}
        onSignIn={onSignIn}
      />
      <div className="app-body">
        {isHall && hallVenue && (() => {
          const websiteUrl = venueWebsiteUrl(hallVenue.contact);
          const pay = venuePaymentBadge(hallVenue.paymentType);
          // `window` is shadowed by the window-state var here, so reach the
          // browser global via `globalThis`. Use the current page's canonical
          // URL (no query/hash) so the QR/link stay correct whether the path
          // uses the raw id today or a readable slug later.
          const hallUrl = `${globalThis.location.origin}${globalThis.location.pathname}`;
          return (
            <div className="fpp-list fpp-venue-list">
              <div className="fpp-card fpp-card--venue">
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fpp-card-name">
                      <span className="cue-ball-icon" aria-hidden="true" style={{ fontSize: "18.4px" }} /> {hallVenue.name}
                    </div>
                    {hallVenue.locality && <div className="fpp-card-loc">📍 {hallVenue.locality}</div>}
                    {hallVenue.tableCount != null && (
                      <div className="fpp-card-loc">🎱 {hallVenue.tableCount} Tables</div>
                    )}
                    {data?.totalPlayers != null && (
                      <div className="fpp-card-loc">🙋‍♂️ {data.totalPlayers} {data.totalPlayers === 1 ? "Player" : "Players"}</div>
                    )}
                    {pay && (
                      <div className="fpp-card-pay">
                        <span className="fpp-pay-badge">{pay.icon} {pay.label}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <span
                      style={{ background: "#fff", padding: 5, borderRadius: 4, lineHeight: 0 }}
                      title="Scan to open this hall's leaderboard"
                    >
                      <QRCodeSVG value={hallUrl} size={72} level="M" />
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 11, padding: "1px 8px", width: "100%" }}
                      onClick={() => {
                        navigator.clipboard.writeText(hallUrl).then(
                          () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); },
                          () => { setLinkCopyFailed(true); setTimeout(() => setLinkCopyFailed(false), 2000); },
                        );
                      }}
                    >
                      {linkCopied ? "✓ Copied" : linkCopyFailed ? "⚠ Failed" : "📋 Copy"}
                    </button>
                  </div>
                </div>
                <div className="fpp-card-actions">
                  <a
                    className="btn"
                    href={`https://www.google.com/maps?q=${hallVenue.latitude},${hallVenue.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🗺️ Open in Maps
                  </a>
                  {websiteUrl && (
                    <a
                      className="btn"
                      href={websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      🌐 Website
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {(isAuthenticated || isHall) && <div className="panel">
          <div className="panel-header">
            <span>
              {isHall
                ? `🏆 ${hallVenue?.name ?? "Local"} · Local`
                : "🏆 Leaderboard"}
            </span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {MODES.map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    className={`btn${active ? " btn-primary" : ""}`}
                    style={{ flex: 1, padding: "6px 4px" }}
                    onClick={() => chooseMode(m)}
                  >
                    {MODE_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {WINDOWS.map((w) => {
                const active = window === w;
                const locked = w !== "30d" && !isPass;
                return (
                  <button
                    key={w}
                    className={`btn${active ? " btn-primary" : ""}`}
                    style={{ flex: 1, padding: "6px 4px" }}
                    disabled={locked}
                    title={locked ? "Get a pass to unlock longer windows" : undefined}
                    onClick={() => chooseWindow(w)}
                  >
                    {WINDOW_LABEL[w]} {locked ? "🔒" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>}

        {isHall && hallVenue && !isAuthenticated && (
          <div className="panel">
            <div className="panel-body" style={{ textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#444", margin: "0 0 8px", lineHeight: 1.4 }}>
                🎱 Play here? Sign up free to track your scores and climb {hallVenue.name}'s board.
              </p>
              <button className="btn btn-primary w-full" onClick={onSignIn}>
                Sign up free →
              </button>
            </div>
          </div>
        )}

        {!authLoading && !isAuthenticated && !isHall && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontSize: 13, color: "#444", marginTop: 0 }}>
                🔓 Sign in to view the full leaderboard.
              </p>
              <button className="btn btn-primary w-full" onClick={onSignIn}>
                Sign in →
              </button>
            </div>
          </div>
        )}

        {(isAuthenticated || isHall) && q.isLoading && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>▌ Loading…</p>
            </div>
          </div>
        )}

        {(isAuthenticated || isHall) && q.isError && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontSize: 12, color: "#c00" }}>⚠ Couldn't load the leaderboard. Try again shortly.</p>
            </div>
          </div>
        )}

        {(isAuthenticated || isHall) && (
          <div className="notice">
            <span>ℹ</span>
            <span>
              {isHall
                ? `Local Rankings${hallVenue?.locality ? ` · ${hallVenue.locality}` : ""} Recent ${MODE_LABEL_PROSE[mode]} 1-on-1 games.`
                : `Top pace & accuracy, recent ${MODE_LABEL_PROSE[mode]} 1-on-1 games only.`}
            </span>
          </div>
        )}

        {(isAuthenticated || isHall) && data && !q.isLoading && (
          <div className="panel">
            <div className="panel-body panel--wood" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {rows.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                  <p style={{ fontSize: 13, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)", margin: 0, textAlign: "center" }}>
                    🎱 No ranked players yet.
                  </p>
                  <p style={{ fontSize: 12, color: "#cde8cd", textShadow: "0 1px 2px rgba(0,0,0,0.5)", margin: 0, textAlign: "center" }}>
                    Looking for a game?
                  </p>
                  <button className="btn" onClick={onFindPlayers}>
                    🤝 Find a meetup →
                  </button>
                </div>
              ) : (
                <>
                  {rows.map((row) => (
                    <LeaderboardRowCard
                      key={row.screenName}
                      row={row}
                      onWho={(name) => setLocation(`/watch/${encodeURIComponent(name)}`)}
                    />
                  ))}
                  {data.totalPages > 1 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                      <button
                        className="btn"
                        disabled={data.page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        ← Prev
                      </button>
                      <span
                        style={{
                          flex: 1,
                          textAlign: "center",
                          fontSize: 12,
                          color: "#fff",
                          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        }}
                      >
                        {data.page} / {data.totalPages}
                      </span>
                      <button
                        className="btn"
                        disabled={data.page >= data.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
