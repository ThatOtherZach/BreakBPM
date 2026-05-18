import { useState } from "react";
import { useLocation } from "wouter";
import {
  useUpdateScreenName,
  useGetMe,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/authClient";
import Navbar from "./Navbar";

/**
 * Mandatory first-login screen-name picker. Mounted by App when
 * `me.needsOnboarding` is true. The user cannot reach the rest of the app
 * until they confirm a name (or sign out).
 */
export default function OnboardingGate() {
  const me = useGetMe();
  const updateName = useUpdateScreenName();
  const qc = useQueryClient();
  const { logout: signOut } = useAuth();
  const [, setLocation] = useLocation();

  const suggested = me.data?.account?.screenName ?? "";
  const [name, setName] = useState(suggested.startsWith("Player_") ? "" : suggested);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError("Pick a screen name (1–32 characters).");
      return;
    }
    try {
      await updateName.mutateAsync({ data: { screenName: trimmed } });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <div className="app-window">
      <Navbar
        onAbout={() => setLocation("/about")}
        onAccount={() => setLocation("/account")}
      />
      <div className="app-body">
        <div className="panel">
          <div
            className="panel-header"
            style={{ background: "linear-gradient(to right, #000080, #1084d0)", color: "#fff" }}
          >
            <span>👋 Welcome — pick a screen name</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, color: "#222" }}>
              This is how you'll appear in your game history. You can change it
              anytime from the Account screen.
            </p>
            <input
              className="input"
              placeholder="Your screen name"
              value={name}
              maxLength={32}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
            {error && <div style={{ color: "#c00", fontSize: 12 }}>{error}</div>}
            <button
              className="btn btn-primary btn-big w-full"
              disabled={updateName.isPending || !name.trim()}
              onClick={handleSave}
            >
              {updateName.isPending ? "Saving…" : "Continue"}
            </button>
            <button
              className="btn"
              onClick={async () => {
                await signOut();
                qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
              }}
            >
              Sign out instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
