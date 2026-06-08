import { useState } from "react";
import {
  useListAdminSales,
  getListAdminSalesUrl,
  type ListAdminSalesParams,
} from "@workspace/api-client-react";

const LIMIT = 50;

/** YYYY-MM-DD for a Date in LOCAL time (matches <input type="date">). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** cents → "$4.99". */
function cad(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const EVENT_LABELS: Record<string, string> = {
  crypto_purchase: "Crypto",
  stripe_purchase: "Card",
  subscription_renewal: "Renewal",
  code_redemption: "Code",
};

/**
 * Shorten a long reference (crypto tx hash / Stripe id) for the table while
 * keeping the full value in a tooltip. Short refs (redeem codes) pass through.
 */
function shortRef(ref: string): string {
  if (ref.length <= 16) return ref;
  return `${ref.slice(0, 8)}…${ref.slice(-6)}`;
}

/**
 * Admin-only sales/revenue ledger. Renders a date-range picker (defaults to the
 * current month), a paginated table with GST + PST as their own columns,
 * full-range revenue totals, and a CSV export for the accountant. Parent gates
 * rendering on `isAdmin`; the endpoint 403s for non-admins regardless.
 */
export default function AdminSalesPanel() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromStr, setFromStr] = useState(ymd(monthStart));
  const [toStr, setToStr] = useState(ymd(now));
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState("");

  // `to` is an INCLUSIVE day in the UI but the API bound is exclusive, so push
  // it to the start of the following day. Both are sent as ISO instants.
  const fromIso = fromStr
    ? new Date(`${fromStr}T00:00:00`).toISOString()
    : undefined;
  const toIso = toStr
    ? (() => {
        const d = new Date(`${toStr}T00:00:00`);
        d.setDate(d.getDate() + 1);
        return d.toISOString();
      })()
    : undefined;

  const params: ListAdminSalesParams = {
    from: fromIso,
    to: toIso,
    page,
    limit: LIMIT,
  };
  const sales = useListAdminSales(params);

  const data = sales.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  async function handleDownloadCsv() {
    setDownloadErr("");
    setDownloading(true);
    try {
      const url = getListAdminSalesUrl({ from: fromIso, to: toIso, format: "csv" });
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `breakbpm-sales-${fromStr}_to_${toStr}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : "Could not export CSV.");
    } finally {
      setDownloading(false);
    }
  }

  function applyRange() {
    setPage(1);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
            🧾
          </span>
          Admin — Sales Ledger
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
          Revenue is GST 5% + PST 7%, tax-INCLUSIVE (backed out of the price).
          Comps (gift/admin/seed codes) show at $0.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11 }}>
            From
            <input
              className="input"
              type="date"
              value={fromStr}
              max={toStr}
              onChange={(e) => {
                setFromStr(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11 }}>
            To
            <input
              className="input"
              type="date"
              value={toStr}
              min={fromStr}
              onChange={(e) => {
                setToStr(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <button className="btn" onClick={applyRange} disabled={sales.isFetching}>
            {sales.isFetching ? "Loading…" : "Refresh"}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownloadCsv}
            disabled={downloading}
          >
            {downloading ? "Exporting…" : "Export CSV"}
          </button>
        </div>

        {downloadErr && (
          <div className="notice">
            <span>ℹ</span>
            <span>{downloadErr}</span>
          </div>
        )}

        {sales.isError && (
          <p style={{ fontSize: 12, color: "#a00", margin: 0 }}>
            Could not load sales.
          </p>
        )}

        {data && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 6,
                fontSize: 12,
              }}
            >
              <Totals label="Gross" value={cad(data.totals.grossCents)} />
              <Totals label="Net (ex-tax)" value={cad(data.totals.netCents)} />
              <Totals label="GST" value={cad(data.totals.gstCents)} />
              <Totals label="PST" value={cad(data.totals.pstCents)} />
              <Totals label="Sales rows" value={String(data.totals.rowCount)} />
              <Totals label="Comps" value={String(data.totals.compCount)} />
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <Th>Date</Th>
                    <Th>User</Th>
                    <Th>Product</Th>
                    <Th>Type</Th>
                    <Th align="right">Gross</Th>
                    <Th align="right">GST</Th>
                    <Th align="right">PST</Th>
                    <Th align="right">Net</Th>
                    <Th>Reference</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: 8, color: "#666" }}>
                        No sales in this range.
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #ddd" }}>
                      <Td>{new Date(r.occurredAt).toLocaleDateString()}</Td>
                      <Td>{r.screenName ?? r.userId ?? "(deleted)"}</Td>
                      <Td>
                        {r.productLabel}
                        {r.isComp ? " (comp)" : ""}
                      </Td>
                      <Td>{EVENT_LABELS[r.eventType] ?? r.eventType}</Td>
                      <Td align="right">{cad(r.grossCents)}</Td>
                      <Td align="right">{cad(r.gstCents)}</Td>
                      <Td align="right">{cad(r.pstCents)}</Td>
                      <Td align="right">{cad(r.netCents)}</Td>
                      <Td>
                        <span title={r.providerRef} style={{ fontFamily: "monospace" }}>
                          {shortRef(r.providerRef)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  className="btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span style={{ fontSize: 11 }}>
                  Page {data.page}/{totalPages}
                </span>
                <button
                  className="btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        background: "rgba(0,0,0,0.04)",
        padding: "4px 8px",
        borderRadius: 4,
      }}
    >
      <span style={{ color: "#555" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th style={{ padding: "4px 6px", textAlign: align, whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td style={{ padding: "4px 6px", textAlign: align, whiteSpace: "nowrap" }}>
      {children}
    </td>
  );
}
