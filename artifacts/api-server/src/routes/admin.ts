import { Router, type IRouter } from "express";
import { db, gamesTable, saleEventsTable, usersTable } from "@workspace/db";
import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import {
  ListAdminSalesResponse,
  ListAdminSalesQueryParams,
  ListAdminLeaderboardResponse,
  ListAdminLeaderboardQueryParams,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { isAdminEmail } from "../lib/config";
import { writeFinalizedSummary } from "../lib/gameSummaryWriter";
import {
  resolveAdminLeaderboard,
  clearAllStatsCache,
  clearLeaderboardCache,
  type LeaderboardMode,
  type LeaderboardWindow,
} from "../lib/stats";

const router: IRouter = Router();

/** Build the shared occurredAt range predicate from optional from/to bounds. */
function rangeWhere(from?: Date, to?: Date): SQL | undefined {
  const clauses: SQL[] = [];
  if (from) clauses.push(gte(saleEventsTable.occurredAt, from));
  if (to) clauses.push(lt(saleEventsTable.occurredAt, to));
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

/** cents → fixed CAD dollars string, e.g. 499 → "4.99". */
function toCad(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Escape one CSV cell (RFC 4180 — quote if it contains , " or newline). */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Sales/revenue ledger for the accountant. Admin-only (403 for everyone else).
 * Returns valued, taxed rows newest-first over an optional [from, to) range
 * plus full-range revenue totals. `format=csv` streams a download of the WHOLE
 * range (pagination is ignored for CSV — the accountant wants every row).
 */
router.get("/admin/sales", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view sales" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  // from/to arrive as ISO strings on the query string, but the generated schema
  // types them as Date (format: date-time). Coerce before validating so the
  // schema's date validation (rejecting garbage) still applies.
  const rawQuery = req.query as Record<string, unknown>;
  const coercedQuery = {
    ...rawQuery,
    from:
      typeof rawQuery.from === "string" && rawQuery.from
        ? new Date(rawQuery.from)
        : undefined,
    to:
      typeof rawQuery.to === "string" && rawQuery.to
        ? new Date(rawQuery.to)
        : undefined,
  };
  const parsed = ListAdminSalesQueryParams.safeParse(coercedQuery);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { from, to, page, limit, format } = parsed.data;
  const where = rangeWhere(from, to);

  // Full-range totals (all pages). gross/gst/pst/net summed; compCount counts
  // comp rows; rowCount is the total matching rows (drives pagination too).
  const [totalsRow] = await db
    .select({
      grossCents: sql<number>`coalesce(sum(${saleEventsTable.grossCents}), 0)::int`,
      gstCents: sql<number>`coalesce(sum(${saleEventsTable.gstCents}), 0)::int`,
      pstCents: sql<number>`coalesce(sum(${saleEventsTable.pstCents}), 0)::int`,
      netCents: sql<number>`coalesce(sum(${saleEventsTable.netCents}), 0)::int`,
      compCount: sql<number>`coalesce(sum(case when ${saleEventsTable.isComp} then 1 else 0 end), 0)::int`,
      rowCount: sql<number>`count(*)::int`,
    })
    .from(saleEventsTable)
    .where(where ?? sql`true`);

  const totals = {
    grossCents: totalsRow?.grossCents ?? 0,
    gstCents: totalsRow?.gstCents ?? 0,
    pstCents: totalsRow?.pstCents ?? 0,
    netCents: totalsRow?.netCents ?? 0,
    compCount: totalsRow?.compCount ?? 0,
    rowCount: totalsRow?.rowCount ?? 0,
  };

  const baseSelect = {
    id: saleEventsTable.id,
    userId: saleEventsTable.userId,
    screenName: usersTable.screenName,
    eventType: saleEventsTable.eventType,
    productLabel: saleEventsTable.productLabel,
    paymentMethod: saleEventsTable.paymentMethod,
    isComp: saleEventsTable.isComp,
    grossCents: saleEventsTable.grossCents,
    gstCents: saleEventsTable.gstCents,
    pstCents: saleEventsTable.pstCents,
    netCents: saleEventsTable.netCents,
    sourceGrossCents: saleEventsTable.sourceGrossCents,
    sourceCurrency: saleEventsTable.sourceCurrency,
    fxRateMicros: saleEventsTable.fxRateMicros,
    fxRateDate: saleEventsTable.fxRateDate,
    providerRef: saleEventsTable.providerRef,
    occurredAt: saleEventsTable.occurredAt,
  };

  if (format === "csv") {
    // Stream the entire range, newest-first. No pagination for exports.
    const rows = await db
      .select(baseSelect)
      .from(saleEventsTable)
      .leftJoin(usersTable, eq(saleEventsTable.userId, usersTable.id))
      .where(where ?? sql`true`)
      .orderBy(desc(saleEventsTable.occurredAt));

    const header = [
      "date",
      "user",
      "product",
      "method",
      "comp",
      "gross_cad",
      "gst_cad",
      "pst_cad",
      "net_cad",
      "source_amount",
      "source_currency",
      "fx_rate",
      "fx_date",
      "reference",
    ].join(",");
    const lines = rows.map((r) =>
      [
        r.occurredAt.toISOString(),
        r.screenName ?? r.userId ?? "(deleted)",
        r.productLabel,
        r.paymentMethod,
        r.isComp ? "yes" : "no",
        toCad(r.grossCents),
        toCad(r.gstCents),
        toCad(r.pstCents),
        toCad(r.netCents),
        toCad(r.sourceGrossCents),
        r.sourceCurrency,
        (r.fxRateMicros / 1_000_000).toFixed(6),
        r.fxRateDate ?? "",
        r.providerRef,
      ]
        .map((c) => csvCell(String(c)))
        .join(","),
    );
    const csv = [header, ...lines].join("\r\n");
    const fname = `breakbpm-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(csv);
    return;
  }

  const rows = await db
    .select(baseSelect)
    .from(saleEventsTable)
    .leftJoin(usersTable, eq(saleEventsTable.userId, usersTable.id))
    .where(where ?? sql`true`)
    .orderBy(desc(saleEventsTable.occurredAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json(
    ListAdminSalesResponse.parse({
      rows,
      totals,
      page,
      limit,
      total: totals.rowCount,
    }),
  );
});

/**
 * One-shot global summary backfill. Recomputes + writes the authoritative
 * distilled summary for every finalized game (game-level + each participant) so
 * the bulk read paths stop skipping summary-less rows. Idempotent — the writer
 * overwrites the same values every run. Admin-only; flushes the stats and
 * leaderboard caches afterwards so the repaired rows show immediately (notably
 * the global averages). This is the forced counterpart to the per-user lazy
 * self-heal, useful as a one-shot after a deploy that introduced summaries.
 */
router.post(
  "/admin/backfill-game-summaries",
  async (req, res): Promise<void> => {
    const user = await getOrCreateUser(req);
    if (!user) {
      res.status(401).json({ success: false, reason: "not_signed_in", scanned: 0, summarized: 0, failed: 0 });
      return;
    }
    if (!isAdminEmail(user.email)) {
      res.status(403).json({ success: false, reason: "not_admin", scanned: 0, summarized: 0, failed: 0 });
      return;
    }

    const rows = await db
      .select({ id: gamesTable.id, gameState: gamesTable.gameState })
      .from(gamesTable)
      .where(isNotNull(gamesTable.endedAt));

    let summarized = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        // Pass the row we already hold so the writer skips a redundant re-read.
        await writeFinalizedSummary(row.id, row.gameState);
        summarized++;
      } catch (err) {
        failed++;
        req.log.warn(
          { gameId: row.id, err },
          "admin backfill: failed to summarize game",
        );
      }
    }

    if (summarized > 0) {
      clearAllStatsCache();
      clearLeaderboardCache();
    }
    req.log.info(
      { scanned: rows.length, summarized, failed },
      "admin backfill: game summaries complete",
    );
    res.json({ success: true, scanned: rows.length, summarized, failed });
  },
);

/**
 * Admin-only leaderboard with the raw composite score and anti-cheat signals
 * (`trustedGames`), and the `provisional` thin-sample flag. Lets an admin eyeball
 * suspicious early ranks (e.g. a top spot built entirely on guest games).
 */
router.get("/admin/leaderboard", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view the leaderboard" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = ListAdminLeaderboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { mode, window } = parsed.data;

  const rows = await resolveAdminLeaderboard(
    mode as LeaderboardMode,
    window as LeaderboardWindow,
  );

  res.json(
    ListAdminLeaderboardResponse.parse({
      mode,
      window,
      rows,
    }),
  );
});

export default router;
