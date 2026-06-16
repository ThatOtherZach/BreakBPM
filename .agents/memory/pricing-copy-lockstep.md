---
name: Pricing/offer copy lockstep (breakbpm)
description: The marketing/SEO surfaces that advertise pass prices/offers/payment methods are duplicated in several places that must change together.
---

# Pricing / offer / payment-method copy is duplicated across many surfaces

When changing what passes/offers/payment methods BreakBPM advertises (e.g. "subscriptions off", "crypto only", a price change), you must update ALL of these or the crawlable/prerendered content drifts from the live UI:

- `src/components/PricingPanel.tsx` — the always-visible public pricing panel (`STATIC_PLAN_SUMMARIES`, the 14-Day card-store callout, the Lucky Break callout). This ONE component is now shared by BOTH the Passes screen and the bottom of the About page, so the in-app public pricing copy is centralized here (edit it once to cover both surfaces). It reads `storeUrl`/Lucky Break odds from server config.
- `src/components/PassesScreen.tsx` — renders `<PricingPanel>` for the public panel; still owns the authenticated card-payment panel (gated on `cardPaymentsEnabled`) and crypto checkout.
- `src/lib/pageMeta.ts` — `PAGE_META.passes` (runtime `<title>`/meta, set by JS).
- `vite.config.ts` — THREE separate copies for prerender: (a) the `passes` route entry in the route-meta array (a build-time DUPLICATE of `pageMeta.ts`, easy to miss), (b) `buildPassesBody()` plan rows + payment line, (c) `poolStatsAppJsonLd()` `offers[]`.
- `index.html` — the static home `WebApplication` JSON-LD `offers[]`. **Inherited by every prerendered route that has no `jsonLd` of its own** (passes/about/legal), because `injectRouteMeta` only replaces the JSON-LD when `route.jsonLd` is set. So a stale offer here shows up on `/passes`, `/about`, `/legal` prerenders too.
- `public/llms.txt` — LLM-facing prose about how passes are bought.
- `src/ABOUT.md` — pricing table (framed as fixed-duration passes).
- `src/legal/TERMS_OF_SERVICE.md` + `src/legal/DATA_POLICY.md` — the ONLY two legal docs rendered on `/legal` (imported `?raw` by `LegalDisclosure.tsx`, rendered client-side, so the text lives in the JS bundle, NOT the prerendered `legal/index.html`). They state the payment method ("purchased by card / cryptocurrency / redeem code") and list Stripe as a sub-processor — so a payment-method change (e.g. crypto-only) must update them too. `src/legal/SUBSCRIPTION_TERMS.md` is NOT imported anywhere — it is dead/not user-facing, so leave it.

**Why:** these are independent hardcoded copies (not a shared module), so a single edit silently leaves the prerendered HTML / JSON-LD / llms.txt advertising the old thing. In one pass I fixed PassesScreen + pageMeta + buildPassesBody + the pool-stats JSON-LD, but missed the duplicate route-meta block, the inherited `index.html` JSON-LD, and `llms.txt`.

**How to apply:** after any pricing/offer/payment-method change, rebuild (`PORT=5000 BASE_PATH=/ pnpm --filter @workspace/breakbpm run build`) and grep the BUILT output (`dist/public/{index,passes/index,pool-stats-app/index,about/index,legal/index}.html` + `dist/public/llms.txt`) for the removed terms — verifying source files alone is not enough. Subscriptions are card-billed, so gate subscription display on `cardPaymentsEnabled`; legal docs (SUBSCRIPTION_TERMS / CANCELLATION) intentionally keep describing subscriptions because the feature is toggled off, not deleted, and existing subs must still cancel.
