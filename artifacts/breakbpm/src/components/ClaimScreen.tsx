import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/authClient";
import {
  useGetMe,
  useClaimFreePass,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
  getGetFreePassClaimStatusQueryKey,
  type LuckyBreakResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import LuckyBreakReveal from "./LuckyBreakReveal";
import { savePendingClaim, clearPendingClaim } from "../lib/pendingClaim";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The rack tumbles for at least this long so a seeded Lucky Break draw always
// feels like a genuine roll, even when the server responds instantly. Mirrors
// RedeemScreen so the claim reveal matches the redeem-link reveal.
const MIN_ROLL_MS = 2200;

// "auth" — waiting for auth/account to resolve, or bouncing to sign-up.
// "claiming" — calling the claim endpoint.
// "rolling" / "result" — Lucky Break reveal phases (lucky_break reward only).
// "done" — finished (success or an expected refusal), message shown.
type Phase = "auth" | "claiming" | "rolling" | "result" | "done";

interface Props {
  onHome: () => void;
  onAccount: () => void;
  onAbout: () => void;
  onSignUp: () => void;
}

/**
 * The landing-page free-pass claim flow.
 *
 * Flow (mirrors RedeemScreen, but the reward is drawn server-side — there is no
 * code in the URL):
 *  - Stash a claim intent (so it survives the sign-up/sign-in redirect).
 *  - Signed out → bounce to sign-up; the top-level resumer brings the user back
 *    here once authenticated.
 *  - Signed in → call POST /passes/claim once, then show the result. A
 *    lucky_break reward plays the standard "rolling the rack" reveal; a day
 *    reward (or any refusal) shows a plain message.
 *
 * The stored intent is cleared on both success and failure so a claim isn't
 * re-run on a later visit.
 */
export default function ClaimScreen({ onHome, onAccount, onAbout, onSignUp }: Props) {
  const { isAuthenticated, isLoading } = useAuth();
  const me = useGetMe();
  const qc = useQueryClient();
  const claim = useClaimFreePass();

  const [phase, setPhase] = useState<Phase>("auth");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [revealResult, setRevealResult] = useState<LuckyBreakResult | null>(null);
  // Guard so the one-shot claim effect never fires twice (React strict mode
  // double-invoke, or re-renders while the request is in flight).
  const attempted = useRef(false);

  // Persist immediately so the intent survives the sign-up/sign-in round trip.
  useEffect(() => {
    savePendingClaim();
  }, []);

  // Signed-out visitor → into the auth flow. The resumer redirects back here.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) onSignUp();
  }, [isLoading, isAuthenticated, onSignUp]);

  // Auto-run once authenticated AND the local account row has resolved
  // (getOrCreateUser needs the session; /me confirms the account exists).
  useEffect(() => {
    if (attempted.current) return;
    if (isLoading || !isAuthenticated) return;
    if (me.isLoading || !me.data?.signedIn) return;
    attempted.current = true;

    void (async () => {
      setPhase("claiming");
      try {
        const result = await claim.mutateAsync();
        // Claimed (or refused for a known reason) — never re-run this intent.
        clearPendingClaim();
        setSuccess(result.success);
        if (result.success) {
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
          qc.invalidateQueries({ queryKey: getGetFreePassClaimStatusQueryKey() });
        }
        if (result.luckyBreak) {
          // Lucky Break reward → tumble the rack for a beat, then land on the
          // server-decided tier (same reveal as the Account/redeem flow).
          setPhase("rolling");
          await delay(MIN_ROLL_MS);
          setRevealResult(result.luckyBreak);
          setPhase("result");
          setMessage(result.message);
        } else {
          setMessage(result.message);
          setPhase("done");
        }
      } catch (e) {
        clearPendingClaim();
        setSuccess(false);
        setMessage(e instanceof Error ? e.message : "Couldn't claim your free pass.");
        setPhase("done");
      }
    })();
  }, [isLoading, isAuthenticated, me.isLoading, me.data?.signedIn, qc, claim]);

  // Lucky Break reveal owns the whole screen during rolling/result.
  if (phase === "rolling" || phase === "result") {
    return (
      <LuckyBreakReveal
        phase={phase === "result" ? "result" : "rolling"}
        result={revealResult}
        onClose={onAccount}
      />
    );
  }

  const working = phase === "auth" || phase === "claiming";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onHome} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignUp} />
      <div className="app-body">
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true">🎁</span>Free Pass
            </span>
          </div>
          <div className="panel-body">
            {working && (
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>
                {phase === "auth" ? "Checking your account…" : "Pulling your free pass…"}
              </p>
            )}

            {phase === "done" && (
              <>
                <p
                  style={{
                    fontSize: 14,
                    marginBottom: 12,
                    color: success ? "#0a0" : "#c00",
                  }}
                >
                  {success ? "✓ " : "✗ "}
                  {message}
                </p>
                <button
                  className="btn btn-primary btn-big w-full"
                  onClick={success ? onAccount : onHome}
                >
                  {success ? "View My Account" : "Back to BreakBPM"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
