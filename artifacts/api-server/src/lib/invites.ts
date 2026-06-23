import { randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  inviteRedemptionsTable,
  type Pass,
} from "@workspace/db";
import { newId } from "./ids";
import { issuePassTx } from "./passes";
import { recordSaleEventTx } from "./saleEvents";
import { inviteTrialHours } from "./config";
import type { UsdCadRate } from "./fx";

/**
 * Invite-link free trial (#308). Every signed-in user gets a stable personal
 * invite code (built into a `/invite/{code}` link). When a NEW user redeems it
 * at signup, they get a short, env-configurable free trial pass. The trial is
 * ONE-SIDED — the inviter receives nothing — and granted at most ONCE per new
 * user, ever (UNIQUE(invited_user_id) on invite_redemptions). Self-invites,
 * existing users, and users who already hold a pass grant nothing.
 */

/**
 * A redeemer only counts as "new" if their account was created within this
 * window before they accept. This is the rule that makes the trial a
 * sign-up perk: an existing user clicking an invite link grants nothing. The
 * window is generous (matches the client-side stash TTL) so the redeem can
 * survive the Clerk sign-up redirect round-trip.
 */
export const INVITE_SIGNUP_WINDOW_MS = 30 * 60 * 1000;

/** Confusable-free alphabet (no 0/O/1/I) for friendly invite codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Reasons the accept flow can refuse. Thrown inside the tx so pg rolls back any
 * partial writes; the route maps `reason` → a user-facing message.
 */
export type InviteFailureReason =
  | "invalid_code"
  | "self_invite"
  | "not_new_user"
  | "has_pass"
  | "already_redeemed";

export class InviteFailure extends Error {
  constructor(public readonly reason: InviteFailureReason) {
    super(reason);
  }
}

/**
 * Return the caller's stable invite code, generating + persisting one on first
 * request. Idempotent: a concurrent generation that loses the UNIQUE race is
 * resolved by re-reading the now-present row. A vanishingly-rare code collision
 * (32^8 ≈ 1e12) retries a few times before giving up.
 */
export async function getOrCreateInviteCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ inviteCode: usersTable.inviteCode })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (existing?.inviteCode) return existing.inviteCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomInviteCode();
    try {
      // Only set the code if it's still NULL — a concurrent request that beat
      // us leaves the column non-null, so our UPDATE touches zero rows and we
      // fall through to re-read the winner's code below.
      const updated = await db
        .update(usersTable)
        .set({ inviteCode: code })
        .where(and(eq(usersTable.id, userId), sql`${usersTable.inviteCode} IS NULL`))
        .returning({ inviteCode: usersTable.inviteCode });
      if (updated[0]?.inviteCode) return updated[0].inviteCode;

      // Our UPDATE was a no-op: another request already set a code. Re-read it.
      const [row] = await db
        .select({ inviteCode: usersTable.inviteCode })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (row?.inviteCode) return row.inviteCode;
    } catch (e) {
      // UNIQUE(invite_code) collision with a different user — retry a new code.
      const sqlState =
        (e as { code?: string }).code ??
        (e as { cause?: { code?: string } }).cause?.code;
      if (sqlState === "23505") continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a unique invite code");
}

export interface AcceptInviteInput {
  /** The signed-in user redeeming the invite link. */
  invitedUserId: string;
  /** When the redeemer's account was created (the new-user gate). */
  invitedUserCreatedAt: Date;
  /** The inviter's code from the link (already uppercased by the caller). */
  code: string;
}

export interface AcceptInviteDeps {
  /** USD→CAD rate frozen by the caller BEFORE the tx (fx.ts never throws). */
  fx: UsdCadRate;
  /** Idempotency key for the ledger row (one per invite_redemptions row). */
  redemptionId: string;
}

/**
 * Grant the invite-link free trial inside a caller-provided transaction. Throws
 * InviteFailure for every refusal path so pg rolls back partial writes. The
 * grant is booked as a $0 comp in the sales ledger (frozen BoC FX) — the user
 * paid nothing.
 *
 * The active-pass pre-check is expected to run in the route BEFORE the tx (to
 * avoid burning work); this helper re-validates the self-invite, new-user, and
 * once-per-user rules authoritatively under the tx.
 */
export async function acceptInviteTx(
  tx: Pick<typeof db, "select" | "insert">,
  input: AcceptInviteInput,
  deps: AcceptInviteDeps,
): Promise<{ pass: Pass; trialHours: number }> {
  const [inviter] = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.inviteCode, input.code))
    .limit(1);
  if (!inviter) throw new InviteFailure("invalid_code");
  if (inviter.id === input.invitedUserId) throw new InviteFailure("self_invite");

  const ageMs = Date.now() - input.invitedUserCreatedAt.getTime();
  if (ageMs > INVITE_SIGNUP_WINDOW_MS) throw new InviteFailure("not_new_user");

  const trialHours = inviteTrialHours();
  const pass = await issuePassTx(tx, {
    userId: input.invitedUserId,
    kind: "day",
    source: "grant",
    sourceRef: `invite:${input.code}`,
    durationSeconds: trialHours * 60 * 60,
  });

  // One trial per new user, ever. UNIQUE(invited_user_id) is the race backstop:
  // a second concurrent accept fails here and rolls back the issued pass.
  try {
    await tx.insert(inviteRedemptionsTable).values({
      id: newId(),
      inviterUserId: inviter.id,
      invitedUserId: input.invitedUserId,
      code: input.code,
      passId: pass.id,
    });
  } catch (e) {
    const sqlState =
      (e as { code?: string }).code ??
      (e as { cause?: { code?: string } }).cause?.code;
    if (sqlState === "23505") throw new InviteFailure("already_redeemed");
    throw e;
  }

  // $0 comp in the sales ledger (the trial is free). Frozen BoC FX, same
  // pattern as every other code/comp redemption.
  await recordSaleEventTx(tx, {
    userId: input.invitedUserId,
    eventType: "code_redemption",
    paymentMethod: "code",
    grossCents: 0,
    isComp: true,
    productLabel: `Invite Trial (${trialHours} ${trialHours === 1 ? "hour" : "hours"})`,
    fx: deps.fx,
    providerRef: deps.redemptionId,
  });

  return { pass, trialHours };
}
