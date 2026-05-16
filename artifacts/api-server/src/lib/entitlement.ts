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

function passSummary(p: Pass): PassSummary {
  const expiresAt = new Date(p.startedAt.getTime() + p.durationSeconds * 1000);
  return {
    kind: p.kind as PassSummary["kind"],
    startedAt: p.startedAt,
    expiresAt,
    isLifetime: p.kind === "lifetime",
  };
}

/** All non-expired passes for a user, newest expiry first. */
export async function getActivePasses(userId: string, now: Date = new Date()): Promise<PassSummary[]> {
  const all = await db
    .select()
    .from(passesTable)
    .where(eq(passesTable.userId, userId))
    .orderBy(desc(passesTable.startedAt));
  return all.map(passSummary).filter((p) => p.expiresAt > now);
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
