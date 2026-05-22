import { useState, useEffect } from "react";
import { useAuth, signInPath } from "../lib/authClient";
import {
  useGetMe,
  useUpdateScreenName,
  useGetGameHistory,
  useDevGrantLifetime,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import SharkIcon from "./SharkIcon";
import { SHARK_PLAYER_NAME } from "../lib/gameLogic";

interface Props {
  onBack: () => void;
  onPasses: () => void;
  onAbout: () => void;
  onSignIn: () => void;
}

function fmtMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString();
}

const GAME_TYPE_LABEL: Record<string, string> = {
  "8ball": "8-Ball",
  "9ball": "9-Ball",
  practice: "Practice",
};

type OutcomeStyle = { label: string; bg: string; fg: string; border: string; title?: string };
const OUTCOME_STYLE: Record<string, OutcomeStyle> = {
  won: { label: "WIN", bg: "#2e7d32", fg: "#fff", border: "#1b5e20" },
  lost: { label: "LOSS", bg: "#c62828", fg: "#fff", border: "#8e1b1b" },
  forfeit: {
    label: "DNF",
    bg: "#dddddd",
    fg: "#444",
    border: "#999",
    title: "Forfeit — Did Not Finish",
  },
  completed: { label: "DONE", bg: "#c0c0c0", fg: "#000080", border: "#808080" },
};

function ResultBadge({ outcome }: { outcome: string }) {
  const s = OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.completed;
  return (
    <span
      title={s.title}
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: "bold",
        letterSpacing: 0.5,
        padding: "1px 6px",
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      {s.label}
    </span>
  );
}

export default function AccountScreen({ onBack, onPasses, onAbout, onSignIn }: Props) {
  const { logout: signOut } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  // TODO(remove-before-launch): paired with the dev upgrade button below.
  const [devGrantError, setDevGrantError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);

  const me = useGetMe();
  const history = useGetGameHistory({ page: historyPage });
  const updateName = useUpdateScreenName();
  // TODO(remove-before-launch): dev-only free Lifetime upgrade hook.
  const devGrant = useDevGrantLifetime();

  useEffect(() => {
    if (me.data?.account?.screenName) setName(me.data.account.screenName);
  }, [me.data?.account?.screenName]);

  if (me.isLoading) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
        <div className="app-body">
          <p style={{ fontFamily: "VT323", fontSize: 18 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!me.data?.signedIn) {
    return (
      <div className="app-window app-window--page">
        <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
        <div className="app-body">
          <div className="panel">
            <div className="panel-header"><span>Account</span></div>
            <div className="panel-body">
              <p style={{ fontSize: 13, marginBottom: 10 }}>You're not signed in.</p>
              <button
                className="btn btn-primary btn-big w-full"
                onClick={() => { window.location.href = signInPath(); }}
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const account = me.data.account!;
  const ent = me.data.entitlement;
  const passes = me.data.passes ?? [];
  const canEditName = passes.some((p) => p.isLifetime);

  async function handleSaveName() {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) { setError("Screen name required"); return; }
    try {
      await updateName.mutateAsync({ data: { screenName: trimmed } });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  // TODO(remove-before-launch): dev-only free Lifetime upgrade handler.
  async function handleDevGrant() {
    setDevGrantError("");
    try {
      await devGrant.mutateAsync();
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setDevGrantError(e instanceof Error ? e.message : "Upgrade failed");
    }
  }

  async function handleSignOut() {
    await signOut();
    qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
    onBack();
  }

  const tierLabel =
    ent.tier === "pass"
      ? ent.activePass?.kind === "lifetime" ? "Lifetime Pass ★"
        : ent.activePass?.kind === "year" ? "Year Pass ★"
        : ent.activePass?.kind === "day" ? "Day Pass ★"
        : "Pass Holder ★"
    : ent.tier === "account" ? "Free Account"
    : "Public";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onSignIn={onSignIn} />
      <div className="app-body">

        {/* Identity panel */}
        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><img src="/identity-icon.png" alt="" style={{ width: 13, height: 13, imageRendering: "pixelated", display: "block" }} />Identity</span></div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {editing ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                />
                <button className="btn btn-primary" disabled={updateName.isPending} onClick={handleSaveName}>Save</button>
                <button className="btn" onClick={() => { setEditing(false); setName(account.screenName); }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontFamily: "VT323", fontSize: 22, color: "#000080" }}>{account.screenName}</span>
                {canEditName && (
                  <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}>Edit</button>
                )}
              </div>
            )}
            {!canEditName && !editing && (
              <div style={{ fontSize: 11, color: "#444" }}>
                <button
                  className="link-btn"
                  onClick={onPasses}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#000080",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "inherit",
                  }}
                >
                  Upgrade to Lifetime
                </button>
                {" to customise your screen name."}
              </div>
            )}
            {error && <div style={{ color: "#c00", fontSize: 12 }}>{error}</div>}
            {account.email && (
              <div style={{ fontSize: 11, color: "#444" }}>
                EMAIL — <span style={{ color: "#000" }}>{account.email}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tier panel */}
        <div className="panel">
          <div className="panel-header"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><img src="/tier-icon.png" alt="" style={{ width: 13, height: 13, imageRendering: "pixelated", display: "block" }} />Tier</span></div>
          <div className="panel-body">
            <div style={{ fontFamily: "VT323", fontSize: 24, color: ent.tier === "pass" ? "#006400" : "#000080" }}>
              {tierLabel}
            </div>
            {ent.activePass && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {ent.activePass.isLifetime
                  ? "Never Expires :)"
                  : `Expires ${fmtDate(ent.activePass.expiresAt)}`}
              </div>
            )}
            {passes.length > 1 && (
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>
                {passes.length} active passes (stacked)
              </div>
            )}
            <button className="btn btn-primary w-full" style={{ marginTop: 10 }} onClick={onPasses}>
              {ent.tier === "pass" ? "Manage Passes" : "Get a Pass"}
            </button>
            {/* TODO(remove-before-launch): dev-only free Lifetime upgrade button.
                Rip out together with useDevGrantLifetime import, devGrant state,
                handleDevGrant, and the server-side DEV_FREE_UPGRADE_ENABLED flag.
                Visibility mirrors the server flag exposed on /auth/me. */}
            {!canEditName && me.data.devFreeUpgradeEnabled && (
              <>
                <button
                  className="btn btn-big w-full"
                  style={{
                    marginTop: 8,
                    background: "#90ee90",
                    color: "#003200",
                    fontWeight: "bold",
                  }}
                  disabled={devGrant.isPending}
                  onClick={handleDevGrant}
                >
                  {devGrant.isPending ? "Upgrading…" : "🎉 Upgrade for Free!"}
                </button>
                {devGrantError && (
                  <div style={{ color: "#c00", fontSize: 12, marginTop: 4 }}>
                    {devGrantError}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* History panel */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <img src="/history-icon.png" alt="" style={{ width: 13, height: 13, imageRendering: "pixelated", display: "block" }} />Recent Games
              {history.data && history.data.totalPages > 1
                ? ` — Page ${history.data.page}/${history.data.totalPages}`
                : history.data
                ? ` (${history.data.visibleCount}/${history.data.totalCount})`
                : ""}
            </span>
          </div>
          <div className="panel-body">
            {history.isLoading && <p style={{ fontSize: 12 }}>Loading…</p>}
            {history.data && history.data.games.length === 0 && (
              <p style={{ fontSize: 12, color: "#444" }}>No games saved yet. Play one!</p>
            )}
            {history.data?.games.map((g) => {
              const modeLabel = GAME_TYPE_LABEL[g.gameType] ?? g.gameType;
              const hasBpm = g.bpm != null;
              return (
                <div
                  key={g.id}
                  style={{
                    borderTop: "1px solid #aaa",
                    padding: "6px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {/* Left: mode + result + winner */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontWeight: "bold", fontSize: 13 }}>{modeLabel}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#444", fontSize: 11 }}>
                      <ResultBadge outcome={g.outcome} />
                      {g.winner && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                          {g.winner === SHARK_PLAYER_NAME && <SharkIcon size={12} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {g.winner === SHARK_PLAYER_NAME ? "Shark'd" : g.winner}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Right: BPM hero + time · date */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span
                      style={{
                        fontFamily: "VT323",
                        fontSize: 26,
                        lineHeight: 1,
                        color: hasBpm ? "#000080" : "#999",
                      }}
                    >
                      {hasBpm ? `${g.bpm!.toFixed(1)} BPM` : "— BPM"}
                    </span>
                    <span style={{ fontSize: 10, color: "#666" }}>
                      🕐 {fmtMs(g.durationMs)} · {fmtDate(g.endedAt)}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Pass holder pagination controls — shown for any pass holder,
                with Prev/Next disabled at boundaries */}
            {history.data && ent.hasActivePass && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={history.data.page <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#444" }}>
                  {history.data.page} / {history.data.totalPages}
                </span>
                <button
                  className="btn"
                  disabled={history.data.page >= history.data.totalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Next →
                </button>
              </div>
            )}

            {/* Free-tier upgrade CTA */}
            {history.data?.truncated && (
              <button
                className="btn w-full"
                style={{
                  marginTop: 10,
                  textAlign: "left",
                  fontSize: 12,
                  color: "#000080",
                  background: "#f0f0f0",
                  border: "1px solid #aaa",
                  padding: "6px 8px",
                  cursor: "pointer",
                }}
                onClick={onPasses}
              >
                💡 Showing your {history.data.visibleCount} most recent games. Upgrade to see all {history.data.totalCount} →
              </button>
            )}
          </div>
        </div>

        <button
          className="btn btn-big w-full"
          style={{ marginTop: 8, marginBottom: 16 }}
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
