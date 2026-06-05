---
name: Stripe MCP vs Replit connector are separate accounts/modes
description: The Stripe MCP server and the app's Replit Stripe connector can point at different accounts or test/live modes; the app only ever uses the connector.
---

The app's Stripe credentials come from the **Replit Stripe connector** (`getUncachableStripeClient` → connector `settings.secret`). The **Stripe MCP server** uses its own separately-configured key. These two are NOT guaranteed to be the same Stripe account or the same mode (test vs live).

Observed: connector key sees all 4 seeded plan prices (`metadata.planId` = day/monthly/yearly/lifetime); the MCP key (account "Saym Services", `acct_1PI0i5ATFtbxBjy1`) returned zero active prices and "No such price" when fetching the connector's price IDs by id.

**Why:** Stripe test-mode and live-mode objects are isolated even within one account, and the MCP key may even be a different account entirely. Searching/inspecting via MCP can therefore show an empty or different catalog than what the running app actually charges against.

**How to apply:** Never trust Stripe MCP output as the source of truth for the app's billing data without first confirming MCP is the same account+mode as the connector (e.g. fetch a connector-created object id through MCP). To make checkout work, seed/verify prices through the **connector** path (`pnpm --filter @workspace/scripts run seed:stripe`, which uses the connector key) — not via MCP. Use MCP for ad-hoc Stripe inspection/actions only on whatever account it's wired to.
