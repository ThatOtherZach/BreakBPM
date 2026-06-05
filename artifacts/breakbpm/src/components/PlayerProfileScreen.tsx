import { useLocation } from "wouter";
import Navbar from "./Navbar";
import GameHistoryCard from "./GameHistoryCard";
import { useGetPublicProfile, getGetPublicProfileQueryKey } from "@workspace/api-client-react";
import ballImg from '/eightball_nobg.png';

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
 * Renders a header (player name + member-since) plus their five most recent
 * games using the same cards as the owner's account page. Purely view-only —
 * no scores, no actions, just a showcase. WatchByNameScreen keeps polling in
 * the background and swaps to the live spectator view the moment they break.
 */
export default function PlayerProfileScreen({ name, onBack, onAbout, onAccount, onSignIn }: Props) {
  const [, setLocation] = useLocation();
  const profile = useGetPublicProfile(
    { name },
    { query: { queryKey: getGetPublicProfileQueryKey({ name }) } },
  );

  const notFound = profile.data && !profile.data.found;
  const screenName = profile.data?.screenName ?? name;
  const games = profile.data?.games ?? [];

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
            {/* Header — player identity card */}
            <div
              className="panel"
              style={{
                background: "linear-gradient(135deg, #0b1f3a 0%, #102b1c 100%)",
                border: "1px solid #2a5a3a",
              }}
            >
              <div
                className="panel-body"
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 12px" }}
              >
                {/* 8-ball avatar */}
                <img
                  src={ballImg}
                  alt="8-ball"
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    width: 54,
                    height: 54,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                    filter: "drop-shadow(0 0 12px rgba(0,255,65,0.25))",
                  }}
                />
                <div style={{ minWidth: 0 }}>
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
                    {screenName}
                  </div>
                  <div style={{ fontSize: 12, color: "#d8b4ff", marginTop: 2 }}>
                    {profile.data.memberSince
                      ? `Member since ${fmtMemberSince(profile.data.memberSince)}`
                      : "Member"}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent games — same cards as the account page */}
            <div className="panel">
              <div className="panel-header">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>📜</span>
                  Recent Games
                </span>
              </div>
              <div className="panel-body">
                {games.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#444" }}>No games played yet.</p>
                ) : (
                  games.map((g) => <GameHistoryCard key={g.id} game={g} />)
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
