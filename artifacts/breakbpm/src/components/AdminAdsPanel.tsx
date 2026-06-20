import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminAds,
  useCreateAd,
  useDeleteAd,
  useApproveAd,
  useDenyAd,
  getListAdminAdsQueryKey,
  getListAdsQueryKey,
  type AdminAd,
} from "@workspace/api-client-react";

// Match the admin list page size used by the other admin panels.
const LIMIT = 10;
const HEADLINE_MAX = 60;
const TAGLINE_MAX = 120;

const STATUS_LABEL: Record<AdminAd["status"], string> = {
  pending_review: "In review",
  approved: "Live",
  denied: "Declined",
};

const STATUS_COLOR: Record<AdminAd["status"], string> = {
  pending_review: "#9a7a00",
  approved: "#006400",
  denied: "#a00",
};

/**
 * Admin-only panel to manage the in-game HUD text ads. Add an ad (headline +
 * tagline) and browse/delete existing ones in a paginated list. Parent gates
 * rendering on `isAdmin`; every endpoint also 403s for non-admins. After any
 * mutation both the admin list and the public ads list are invalidated so the
 * HUD rotation picks up the change.
 */
export default function AdminAdsPanel() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const list = useListAdminAds({ page, limit: LIMIT });
  const ads = list.data?.ads ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const createAd = useCreateAd();
  const deleteAd = useDeleteAd();
  const approveAd = useApproveAd();
  const denyAd = useDenyAd();

  const [headline, setHeadline] = useState("");
  const [tagline, setTagline] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Clamp the page when the list shrinks (e.g. after a delete).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListAdminAdsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdsQueryKey() });
  };

  const submit = async () => {
    const h = headline.trim();
    const t = tagline.trim();
    if (!h || !t) {
      setError("Headline and tagline are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await createAd.mutateAsync({ data: { headline: h, tagline: t } });
      if (!res.success) {
        setError(res.reason ?? "Couldn't save the ad.");
        return;
      }
      setHeadline("");
      setTagline("");
      setPage(1);
      invalidate();
    } catch {
      setError("Couldn't save the ad. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await deleteAd.mutateAsync({ id });
      if (!res.success) {
        setError(
          res.reason === "not_found"
            ? "That ad no longer exists."
            : "Couldn't delete the ad.",
        );
        return;
      }
      invalidate();
    } catch {
      setError("Couldn't delete the ad. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await approveAd.mutateAsync({ id });
      if (!res.success) {
        setError(
          res.reason === "not_found"
            ? "That ad no longer exists."
            : "Couldn't approve the ad.",
        );
        return;
      }
      invalidate();
    } catch {
      setError("Couldn't approve the ad. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const deny = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await denyAd.mutateAsync({ id });
      if (!res.success) {
        setError(
          res.reason === "not_found"
            ? "That ad no longer exists."
            : "Couldn't decline the ad.",
        );
        return;
      }
      invalidate();
    } catch {
      setError("Couldn't decline the ad. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
            📢
          </span>
          Admin — HUD Ads
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
          Text ads shown in the live game HUD to non-paying players only (a bold
          headline with a tagline beneath). Every saved ad is in rotation —
          successive games show the next ad in order. Delete to remove one.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="avp-field">
            Headline
            <input
              className="input"
              value={headline}
              maxLength={HEADLINE_MAX}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Corner Pocket Billiards"
            />
          </label>
          <label className="avp-field">
            Tagline
            <input
              className="input"
              value={tagline}
              maxLength={TAGLINE_MAX}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="$5 tables all day Tuesday — downtown"
            />
          </label>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "#a00", margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Add Ad"}
          </button>
        </div>

        <div style={{ borderTop: "1px solid #0002", paddingTop: 8 }}>
          {list.isLoading ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>Loading…</p>
          ) : ads.length === 0 ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
              No ads yet.
            </p>
          ) : (
            <ul className="avp-list">
              {ads.map((ad) => (
                <li key={ad.id} className="avp-row">
                  <div className="avp-row-main">
                    <span className="avp-row-name">{ad.headline}</span>
                    <span className="avp-row-meta">{ad.tagline}</span>
                    <span className="avp-row-meta" style={{ color: "#666" }}>
                      {ad.isHouse
                        ? "House ad"
                        : `${ad.ownerScreenName ?? ad.ownerEmail ?? "User"}${
                            ad.days ? ` · ${ad.days} ${ad.days === 1 ? "day" : "days"}` : ""
                          }${
                            ad.expiryAt && ad.status === "approved"
                              ? ` · until ${new Date(ad.expiryAt).toLocaleDateString()}`
                              : ""
                          }`}
                    </span>
                  </div>
                  <div
                    className="avp-row-actions"
                    style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}
                  >
                    {!ad.isHouse && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: "bold",
                          color: STATUS_COLOR[ad.status],
                        }}
                      >
                        {STATUS_LABEL[ad.status]}
                      </span>
                    )}
                    <div style={{ display: "flex", gap: 4 }}>
                      {!ad.isHouse && ad.status === "pending_review" && (
                        <>
                          <button
                            className="btn btn-primary"
                            onClick={() => approve(ad.id)}
                            disabled={busy}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={() => deny(ad.id)}
                            disabled={busy}
                          >
                            Deny
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => remove(ad.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <div className="fpp-pager">
              <button
                className="btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="fpp-page-label">
                Page {page} / {totalPages}
              </span>
              <button
                className="btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
