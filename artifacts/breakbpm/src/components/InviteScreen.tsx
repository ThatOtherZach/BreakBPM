import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/authClient";
import {
  useGetMe,
  useAcceptInviteTrial,
  getGetMeQueryKey,
  getGetGameHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import Navbar from "./Navbar";
import { savePendingInvite, clearPendingInvite } from "../lib/pendingInvite";

// "auth" — waiting for auth/account to resolve, or bouncing to sign-up.
// "redeeming" — calling the accept endpoint.
// "done" — finished (success or an expected refusal), message shown.
type Phase = "auth" | "redeeming" | "done";

interface Props {
  code: string;
  onHome: () => void;
  onAccount: () => void;
  onManual: () => void;
  onSignUp: () => void;
}

/**
 * Entry point for shareable invite links (`/invite/:code`).
 *
 * Flow:
 *  - Stash the code (so it survives the sign-up/sign-in redirect).
 *  - Signed out → bounce to sign-up; the top-level resumer brings the user
 *    back here once authenticated.
 *  - Signed in → auto-apply the invite-accept endpoint, then show the result.
 *
 * The trial is granted to NEW users only (server-enforced), so an existing
 * user who follows a link just gets a friendly refusal. The stored code is
 * cleared on both success and failure so it isn't re-applied on a later visit.
 */
export default function InviteScreen({ code, onHome, onAccount, onManual, onSignUp }: Props) {
  const { isAuthenticated, isLoading } = useAuth();
  const me = useGetMe();
  const qc = useQueryClient();
  const accept = useAcceptInviteTrial();

  const [phase, setPhase] = useState<Phase>("auth");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  // Guard so the one-shot accept effect never fires twice (React strict mode
  // double-invoke, or re-renders while the request is in flight).
  const attempted = useRef(false);

  const normalized = code.trim().toUpperCase();

  // Persist immediately so the code survives the sign-up/sign-in round trip.
  useEffect(() => {
    if (normalized) savePendingInvite(normalized);
  }, [normalized]);

  // Signed-out visitor → into the sign-up flow. The resumer redirects back here.
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
      clearPendingInvite();
      setSuccess(false);
      setMessage("This link doesn't contain an invite code.");
      setPhase("done");
      return;
    }

    void (async () => {
      setPhase("redeeming");
      try {
        const result = await accept.mutateAsync({ data: { code: normalized } });
        // Applied (or refused for a known reason) — never re-apply this invite.
        clearPendingInvite();
        setSuccess(result.success);
        setMessage(result.message);
        if (result.success) {
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          qc.invalidateQueries({ queryKey: getGetGameHistoryQueryKey() });
        }
        setPhase("done");
      } catch (e) {
        clearPendingInvite();
        setSuccess(false);
        setMessage(e instanceof Error ? e.message : "Couldn't redeem this invite.");
        setPhase("done");
      }
    })();
  }, [isLoading, isAuthenticated, me.isLoading, me.data?.signedIn, normalized, qc, accept]);

  const working = phase === "auth" || phase === "redeeming";

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onHome} onManual={onManual} onAccount={onAccount} onSignIn={onSignUp} />
      <div className="app-body">
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true">🎁</span>Invite — Free Trial
            </span>
          </div>
          <div className="panel-body">
            {working && (
              <p style={{ fontFamily: "VT323", fontSize: 18 }}>
                {phase === "auth" ? "Checking your account…" : "Unlocking your free trial…"}
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
