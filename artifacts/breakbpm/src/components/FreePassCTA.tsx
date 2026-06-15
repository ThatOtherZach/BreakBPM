import { useLocation } from "wouter";
import { useGetFreePassClaimStatus } from "@workspace/api-client-react";

/**
 * Status-driven "claim your free pass" call-to-action, embedded on the
 * `/pool-stats-app` landing page.
 *
 * Reads GET /passes/claim/status to decide what to render: an open claim
 * button (with remaining-stock hint), a "closed for the month" notice, a
 * "you already claimed" / "you already have a pass" state, or — if status
 * can't be read — an optimistic claim button (the server is authoritative and
 * will refuse cleanly). Clicking routes to `/claim`, which owns the auth-gate,
 * claim call, and Lucky Break reveal.
 */
export default function FreePassCTA({ heading }: { heading?: string }) {
  const [, setLocation] = useLocation();
  const status = useGetFreePassClaimStatus();
  const data = status.data;

  const goClaim = () => setLocation("/claim");

  // Treat a status read failure as "probably open" — never hide the offer just
  // because the cheap status call hiccuped; the claim endpoint is authoritative.
  const open = data ? data.open : true;
  const remaining = data ? data.remainingLuckyBreak + data.remainingDay : null;
  const alreadyClaimed = Boolean(data?.signedIn && data.alreadyClaimed);
  const hasPassAlready =
    Boolean(data?.signedIn) && open && !alreadyClaimed && data?.eligible === false;

  let body: React.ReactNode;
  if (status.isLoading) {
    body = (
      <button className="btn btn-primary btn-big w-full" disabled>
        Checking availability…
      </button>
    );
  } else if (alreadyClaimed) {
    body = (
      <>
        <p className="fp-cta-note">✓ You've already claimed your free pass.</p>
        <button className="btn btn-big w-full" onClick={() => setLocation("/account")}>
          View My Account
        </button>
      </>
    );
  } else if (hasPassAlready) {
    body = (
      <>
        <p className="fp-cta-note">You're all set — you already have an active pass.</p>
        <button className="btn btn-big w-full" onClick={() => setLocation("/account")}>
          View My Account
        </button>
      </>
    );
  } else if (!open) {
    body = (
      <>
        <p className="fp-cta-note">
          All free passes for this month are claimed — check back on the 1st!
        </p>
        <button className="btn btn-big w-full" onClick={() => setLocation("/passes")}>
          See Other Ways In
        </button>
      </>
    );
  } else {
    body = (
      <>
        <button className="btn btn-primary btn-big w-full" onClick={goClaim}>
          🎁 Reveal My Free Pass
        </button>
        {remaining !== null && remaining > 0 && (
          <p className="fp-cta-note fp-cta-stock">
            {remaining} free {remaining === 1 ? "pass" : "passes"} left this month
          </p>
        )}
      </>
    );
  }

  return (
    <div className="fp-cta">
      <div className="fp-cta-headline">{heading ?? "Get a free pass — on the house"}</div>
      <p className="fp-cta-sub">
        Every claim is a guaranteed win: at minimum a Day pass, with a real shot at a
        Lucky Break roll for Monthly — or even Lifetime. One per player.
      </p>
      {body}
    </div>
  );
}
