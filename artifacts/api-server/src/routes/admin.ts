import { Router, type IRouter } from "express";
import { db, saleEventsTable, usersTable } from "@workspace/db";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { ListAdminSalesResponse, ListAdminSalesQueryParams } from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { isAdminEmail } from "../lib/config";

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

export default router;
