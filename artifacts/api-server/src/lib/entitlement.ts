import { eq, desc } from "drizzle-orm";
import { db, passesTable, type Pass, type User } from "@workspace/db";

export type Tier = "public" | "account" | "pass";

export interface PassSummary {
  kind: "day" | "year" | "lifetime";
  startedAt: Date;
  expiresAt: Date;
  isLifetime: boolean;
}

export interface Entitlement {
  tier: Tier;
  hasActivePass: boolean;
  /** null = no cap (full history). number = cap to N most recent. */
  historyVisibleLimit: number | null;
  activePass?: PassSummary;
}

export const HISTORY_LIMIT_FREE_ACCOUNT = 3;

/**
 * Sentinel "expires" date for lifetime passes. The DB stores NULL duration
 * for lifetime; the API contract (OpenAPI) still requires `expiresAt`, so we
 * surface a far-future date. Clients should rely on `isLifetime: true`, not
 * this value, when rendering "Lifetime" vs a real expiry.
 */
const LIFETIME_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

function passSummary(p: Pass): PassSummary {
  const expiresAt =
    p.durationSeconds === null
      ? LIFETIME_EXPIRES_AT
      : new Date(p.startedAt.getTime() + p.durationSeconds * 1000);
  return {
    kind: p.kind as PassSummary["kind"],
    startedAt: p.startedAt,
    expiresAt,
    isLifetime: p.kind === "lifetime",
  };
}

/** All currently-active passes for a user, newest expiry first.
 * A pass is active iff it has been issued (`startedAt <= now`) and has not
 * yet expired (`expiresAt > now`). The startedAt guard matters for lifetime
 * passes — without a real expiry, a future-dated row would otherwise count
 * as active immediately. */
export async function getActivePasses(userId: string, now: Date = new Date()): Promise<PassSummary[]> {
  const all = await db
    .select()
    .from(passesTable)
    .where(eq(passesTable.userId, userId))
    .orderBy(desc(passesTable.startedAt));
  return all
    .map(passSummary)
    .filter((p) => p.startedAt <= now && p.expiresAt > now);
}

export async function computeEntitlement(user: User | null): Promise<Entitlement> {
  if (!user) {
    return { tier: "public", hasActivePass: false, historyVisibleLimit: 0 };
  }
  const active = await getActivePasses(user.id);
  if (active.length === 0) {
    return {
      tier: "account",
      hasActivePass: false,
      historyVisibleLimit: HISTORY_LIMIT_FREE_ACCOUNT,
    };
  }
  // Pick the pass with the latest expiry as "the" active pass shown in the UI.
  const headline = active.reduce((a, b) => (b.expiresAt > a.expiresAt ? b : a));
  return {
    tier: "pass",
    hasActivePass: true,
    historyVisibleLimit: null,
    activePass: headline,
  };
}
