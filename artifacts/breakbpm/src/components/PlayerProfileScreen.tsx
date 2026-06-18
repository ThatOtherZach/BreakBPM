import { useLocation } from "wouter";
import Navbar from "./Navbar";
import GameHistoryCard from "./GameHistoryCard";
import StatsHero from "./StatsHero";
import { PlayerName } from "./PlayerName";
import { LeaderboardRowCard } from "./LeaderboardScreen";
import { useAuth } from "../lib/authClient";
import { useGetPublicProfile, getGetPublicProfileQueryKey } from "@workspace/api-client-react";
import { VARIANT_IMAGE_URLS, type BackgroundVariant } from "../lib/backgroundVariants";

interface Props {
  name: string;
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}

function fmtMemberSince(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Public profile shown on /watch/{name} when the player has no live game.
 * Renders the same CRT hero readout as the owner's Stats page (scoped to the
 * player's last 24 hours) plus their five most recent games using the same
 * cards as the owner's account page. Purely view-only — no scores, no actions,
 * just a showcase. WatchByNameScreen keeps polling in the background and swaps
 * to the live spectator view the moment they break.
 */
export default function PlayerProfileScreen({ name, onBack, onAbout, onAccount, onSignIn }: Props) {
  const [, setLocation] = useLocation();
  // Opponent names in the recent-games list are only revealed to signed-in
  // visitors; signed-out spectators see them redacted.
  const { isAuthenticated } = useAuth();
  // Poll the profile so the hero readout and recent games stay live while a
  // watcher sits on the page — roughly the same cadence as the live spectator
  // view. The server busts the player's stats cache when they finish a game,
  // so each poll picks up freshly-completed games instead of cached numbers.
  const profile = useGetPublicProfile(
    { name },
    {
      query: {
        queryKey: getGetPublicProfileQueryKey({ name }),
        refetchInterval: 5000,
      },
    },
  );

  const notFound = profile.data && !profile.data.found;
  const screenName = profile.data?.screenName ?? name;
  const games = profile.data?.games ?? [];
  const stats = profile.data?.stats ?? null;

  // Pass-themed artwork for the CRT stat readout: paid players' hero card wears
  // one of three splash artworks (server-resolved to match their redeem card /
  // Theme override) behind a dark overlay; unpaid/anon players get null and the
  // hero keeps its default CRT look. The page background itself is unchanged.
  const bgVariant = (profile.data?.profileBackground ?? null) as BackgroundVariant | null;
  const heroBackgroundUrl = bgVariant ? VARIANT_IMAGE_URLS[bgVariant] : null;

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      <div className="app-body">
        {profile.isLoading && (
          <div className="notice"><span>📡</span><span>Loading {name}'s profile…</span></div>
        )}

        {profile.isError && (
          <div className="notice" style={{ color: "#c00" }}>
            <span>!</span>
            <span>Couldn't reach the server. Check your connection and try again.</span>
          </div>
        )}

        {notFound && profile.data?.reason === "rate_limited" && (
          <div className="notice" style={{ color: "#c00" }}>
            <span>!</span>
            <span>Too many attempts. Please wait a minute and try again.</span>
          </div>
        )}

        {notFound && profile.data?.reason !== "rate_limited" && (
          <div className="notice" style={{ color: "#c00" }}>
            <span>!</span>
            <span>No player named "{name}". Double-check the link.</span>
          </div>
        )}

        {profile.data?.found && (
          <>
            {/* Header — the same CRT hero readout as the Stats page, scoped to
                this player's last 24 hours. */}
            {stats ? (
              <StatsHero stats={stats} screenName={screenName} rainbowName={profile.data.rainbowName ?? false} joinedAt={profile.data.memberSince} backgroundUrl={heroBackgroundUrl} />
            ) : (
              <div
                className="panel"
                style={{
                  background: "linear-gradient(135deg, #0b1f3a 0%, #102b1c 100%)",
                  border: "1px solid #2a5a3a",
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#00ff41", opacity: 0.8 }}>
                  PLAYER PROFILE
                </div>
                <div
                  style={{
                    fontFamily: "VT323, monospace",
                    fontSize: 32,
                    lineHeight: 1.05,
                    color: "#fff",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <PlayerName name={screenName} rainbow={profile.data.rainbowName ?? false} />
                </div>
                <div style={{ fontSize: 12, color: "#d8b4ff", marginTop: 2 }}>
                  {profile.data.memberSince
                    ? `Member since ${fmtMemberSince(profile.data.memberSince)}`
                    : "Member"}
                </div>
              </div>
            )}

            {/* When the player has no activity in the last 24h, fill the space
                with their own global standing card (the same single felt-tinted
                leaderboard row the owner sees on their account page) instead of
                an empty panel. Hidden when they aren't ranked yet. */}
            {(stats?.gamesPlayed ?? 0) === 0 && profile.data.globalStanding && (
              <div className="panel panel--wood">
                <div className="panel-header">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>🏆</span>
                    Global Standing
                  </span>
                </div>
                <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <LeaderboardRowCard row={profile.data.globalStanding} />
                </div>
              </div>
            )}

            {/* Recent games — same cards as the account page */}
            <div className="panel panel--wood">
              <div className="panel-header">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>📜</span>
                  Recent Games
                </span>
              </div>
              <div className="panel-body">
                {games.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>No games played yet.</p>
                ) : (
                  games.map((g) => (
                    <GameHistoryCard key={g.id} game={g} hideOpponent={!isAuthenticated} />
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <button
          className="btn btn-big btn-full"
          style={{ marginTop: 8, marginBottom: 16 }}
          onClick={() => { onBack(); setLocation("/"); }}
        >
          ← Back to menu
        </button>
      </div>
    </div>
  );
}
