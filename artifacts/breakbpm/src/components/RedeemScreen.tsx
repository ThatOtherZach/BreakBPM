import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/authClient";
import {
  useGetMe,
  useRedeemDiscountCode,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
  type LuckyBreakResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import LuckyBreakReveal from "./LuckyBreakReveal";
import { savePendingRedeem, clearPendingRedeem } from "../lib/pendingRedeem";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The rack tumbles for at least this long so a seeded Lucky Break draw always
// feels like a genuine roll, even when the server responds instantly. Mirrors
// AccountScreen so the redeem-link reveal matches the manual-redeem reveal.
const MIN_ROLL_MS = 2200;

// "auth" — waiting for auth/account to resolve, or bouncing to sign-up.
// "redeeming" — calling the redeem endpoint.
// "rolling" / "result" — Lucky Break reveal phases.
// "done" — finished (success or an expected refusal), message shown.
type Phase = "auth" | "redeeming" | "rolling" | "result" | "done";

interface Props {
  code: string;
  onHome: () => void;
  onAccount: () => void;
  onAbout: () => void;
  onSignUp: () => void;
}

/**
 * Entry point for shareable redeem links (`/redeem/:code`, QR-friendly).
 *
 * Flow:
 *  - Stash the code (so it survives the sign-up/sign-in redirect).
 *  - Signed out → bounce to sign-up; the top-level resumer brings the user
 *    back here once authenticated.
 *  - Signed in → auto-apply the existing redeem endpoint, then show the
 *    standard result (including the Lucky Break reveal when applicable).
 *
 * The stored code is cleared on both success and failure so it isn't
 * re-applied on a later visit.
 */
export default function RedeemScreen({ code, onHome, onAccount, onAbout, onSignUp }: Props) {
  const { isAuthenticated, isLoading } = useAuth();
  const me = useGetMe();
  const qc = useQueryClient();
  const redeem = useRedeemDiscountCode();

  const [phase, setPhase] = useState<Phase>("auth");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [revealResult, setRevealResult] = useState<LuckyBreakResult | null>(null);
  // Guard so the one-shot redeem effect never fires twice (React strict mode
  // double-invoke, or re-renders while the request is in flight).
  const attempted = useRef(false);

  const normalized = code.trim().toUpperCase();

  // Persist immediately so the code survives the sign-up/sign-in round trip.
  useEffect(() => {
    if (normalized) savePendingRedeem(normalized);
  }, [normalized]);

  // Signed-out visitor → into the auth flow. The resumer redirects back here.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) onSignUp();
  }, [isLoading, isAuthenticated, onSignUp]);

  // Auto-apply once authenticated AND the local account row has resolved
  // (getOrCreateUser needs the session; /me confirms the account exists).
  useEffect(() => {
    if (attempted.current) return;
    if (isLoading || !isAuthenticated) return;
    if (me.isLoading || !me.data?.signedIn) return;
    attempted.current = true;

    if (!normalized) {
      clearPendingRedeem();
      setSuccess(false);
      setMessage("This link doesn't contain a code.");
      setPhase("done");
      return;
    }

    void (async () => {
      setPhase("redeeming");
      try {
        const result = await redeem.mutateAsync({ data: { code: normalized } });
        // Applied (or refused for a known reason) — never re-apply this code.
        clearPendingRedeem();
        setSuccess(result.success);
        if (result.success) {
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
        }
        if (result.luckyBreak) {
          // Lucky Break code → tumble the rack for a beat, then land on the
          // server-decided tier (same reveal as the manual Account redeem).
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
        clearPendingRedeem();
        setSuccess(false);
        setMessage(e instanceof Error ? e.message : "Couldn't redeem this code.");
        setPhase("done");
      }
    })();
  }, [isLoading, isAuthenticated, me.isLoading, me.data?.signedIn, normalized, qc, redeem]);

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

  const working = phase === "auth" || phase === "redeeming";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onHome} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignUp} />
      <div className="app-body">
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true">🎟️</span>Redeem Code
            </span>
          </div>
          <div className="panel-body">
            {normalized && (
              <p style={{ fontSize: 13, marginBottom: 10 }}>
                Code: <strong style={{ letterSpacing: 1 }}>{normalized}</strong>
              </p>
            )}

            {working && (
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>
                {phase === "auth" ? "Checking your account…" : "Applying your code…"}
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
