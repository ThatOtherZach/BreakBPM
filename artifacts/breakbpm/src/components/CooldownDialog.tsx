import { useEffect, useState } from "react";

interface Props {
  cooldownSecondsRemaining: number;
  onDismiss: () => void;
  onSignIn: () => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CooldownDialog({ cooldownSecondsRemaining, onDismiss, onSignIn }: Props) {
  const [remaining, setRemaining] = useState(cooldownSecondsRemaining);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="panel"
        style={{ background: "#c0c0c0", maxWidth: 360, width: "100%" }}
      >
        <div
          className="panel-header"
          style={{ background: "linear-gradient(to right, #000080, #1084d0)", color: "#fff" }}
        >
          <span>⏳ Cooldown Active</span>
        </div>
        <div className="panel-body" style={{ padding: 14 }}>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            You've used your free game. The next free game unlocks in:
          </p>
          <div
            style={{
              fontFamily: "VT323, monospace",
              fontSize: 38,
              textAlign: "center",
              color: "#000080",
              padding: "6px 0 12px",
            }}
          >
            {fmt(remaining)}
          </div>
          <p style={{ fontSize: 12, color: "#444", marginBottom: 12 }}>
            Sign in for unlimited play, history, and pass perks.
          </p>
          <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button className="btn btn-primary btn-big" onClick={onSignIn}>
              Sign In
            </button>
            <button className="btn btn-big" onClick={onDismiss} disabled={remaining > 0}>
              {remaining > 0 ? "Wait…" : "Try Again"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
