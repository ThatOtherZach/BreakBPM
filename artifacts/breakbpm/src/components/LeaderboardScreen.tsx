import { useState } from "react";
import { useLocation } from "wouter";
import { useGetLeaderboard, useGetMe } from "@workspace/api-client-react";
import type { LeaderboardRow, GetLeaderboardWindow } from "@workspace/api-client-react";
import Navbar from "./Navbar";
import { useAuth } from "../lib/authClient";
import { THEME_FELT, themeColorOf } from "../lib/backgroundVariants";
import { WinsTodayChip } from "./WinsTodayChip";
import { PlayerName } from "./PlayerName";

const PAGE_SIZE = 50;
const WIDGET_SIZE = 10;

const WINDOW_LABEL: Record<GetLeaderboardWindow, string> = {
  "30d": "30D",
  "90d": "90D",
  all: "ALL",
};
const WINDOWS: GetLeaderboardWindow[] = ["30d", "90d", "all"];

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
        >Everyone →</button>
      </div>
    </div>
  );
}

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onFindPlayers: () => void;
  onStats: () => void;
  onSignIn: () => void;
}

/**
 * Full leaderboard page (login required). 50 standings per page with a
 * 30d / 90d / all-time window toggle — the longer windows are a pass perk
 * (also enforced server-side).
 */
export default function LeaderboardScreen({
  onBack,
  onAbout,
  onAccount,
  onFindPlayers,
  onStats,
  onSignIn,
}: Props) {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const me = useGetMe();
  const isPass = me.data?.entitlement?.tier === "pass";

  const [window, setWindow] = useState<GetLeaderboardWindow>("30d");
  const [page, setPage] = useState(1);

  // The query always runs, but its result is only rendered for signed-in
  // callers (see the `isAuthenticated` gates below). The default window is the
  // public 30d, so an anonymous fetch never 403s.
  const q = useGetLeaderboard({ window, page, pageSize: PAGE_SIZE });
  const data = q.data;
  const rows = data?.rows ?? [];

  function chooseWindow(w: GetLeaderboardWindow) {
    if (w !== "30d" && !isPass) return;
    setWindow(w);
    setPage(1);
  }

  return (
    <div className="app-window app-window--page">
      <Navbar
        onBack={onBack}
        onAbout={onAbout}
        onAccount={onAccount}
        onFindPlayers={onFindPlayers}
        onStats={onStats}
        onSignIn={onSignIn}
      />
      <div className="app-body">
        {isAuthenticated && <div className="panel">
          <div className="panel-header">
            <span>🏆 Leaderboard</span>
            {data && (
              <span style={{ fontSize: 10, color: "#cdd9f0", fontWeight: "normal" }}>
                {data.totalPlayers} {data.totalPlayers === 1 ? "player" : "players"}
              </span>
            )}
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: 11, color: "#444", margin: 0, lineHeight: 1.4 }}>Fastest by BPM, recent 8-ball 1-on-1 games only.</p>
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

        {!authLoading && !isAuthenticated && (
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

        {isAuthenticated && q.isLoading && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>▌ Loading…</p>
            </div>
          </div>
        )}

        {isAuthenticated && q.isError && (
          <div className="panel">
            <div className="panel-body">
              <p style={{ fontSize: 12, color: "#c00" }}>⚠ Couldn't load the leaderboard. Try again shortly.</p>
            </div>
          </div>
        )}

        {isAuthenticated && data && !q.isLoading && (
          <div className="panel">
            <div className="panel-body panel--wood" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {rows.length === 0 ? (
                <p style={{ fontSize: 13, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)", margin: 0 }}>
                  🎱 No ranked players in this window yet.
                </p>
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
