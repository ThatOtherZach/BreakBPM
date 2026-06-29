import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, venuesTable } from "@workspace/db";

const router: IRouter = Router();

// Canonical public origin — matches the hardcoded host used in index.html, the
// page meta, and the static sitemap so every crawlable URL agrees.
const SITE_ORIGIN = "https://breakbpm.com";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * GET /sitemap/venues.xml — a live sitemap of every ACTIVE Verified Hall page
 * (`/leaderboard/hall/:slug`).
 *
 * Hall pages are minted by admins AFTER the frontend static build ships, so a
 * build-time sitemap can never list them. The static `sitemap.xml` is a sitemap
 * INDEX that points here, and this always-on API route (same domain via the
 * shared proxy) reflects venues added at any time. Public + unauthenticated on
 * purpose: it only exposes active venue slugs, which are already public on the
 * hall pages and the Find Players map. This is intentionally NOT part of the
 * OpenAPI/codegen contract — it's crawler-facing XML, not a client JSON API.
 */
router.get("/sitemap/venues.xml", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ slug: venuesTable.slug, updatedAt: venuesTable.updatedAt })
    .from(venuesTable)
    .where(and(eq(venuesTable.active, true), isNotNull(venuesTable.slug)))
    .orderBy(desc(venuesTable.updatedAt));

  const urls = rows
    .filter((r) => r.slug)
    .map((r) => {
      const loc = escapeXml(`${SITE_ORIGIN}/leaderboard/hall/${r.slug}`);
      const lastmod = r.updatedAt ? new Date(r.updatedAt).toISOString() : null;
      return [
        "  <url>",
        `    <loc>${loc}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        "    <changefreq>weekly</changefreq>",
        "    <priority>0.6</priority>",
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}${urls ? "\n" : ""}</urlset>\n`;

  res
    .status(200)
    .type("application/xml")
    .set("Cache-Control", "public, max-age=3600")
    .send(xml);
});

export default router;
