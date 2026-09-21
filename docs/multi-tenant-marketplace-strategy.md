# Possible future: a multi-tenant, sellable version of this connector

**Status: not planned, not started.** This is a speculative direction explored on 2026-09-22 at the
user's request, kept here for reference if it's ever revisited. It does not describe the current
codebase, which is deliberately single-user (see [CLAUDE.md](../CLAUDE.md)'s "Key decisions" section)
and should stay that way unless this plan is explicitly picked up.

## Where things stand today (why this isn't sellable as-is)

- **Self Client OAuth**, not a redirect/consent flow. Authorizing this server means manually visiting
  `api-console.zoho.com`, registering a Self Client, generating a short-lived grant code, and pasting it
  into `scripts/oauth-setup.ts`. That's a fine one-time chore for a single developer; it's not something
  you can ask a paying customer to do.
- **One Lambda, one Secrets Manager secret, one team.** `getContext()` in `src/server.ts` loads a single
  set of Zoho credentials for the whole process, and `ensureTeamId()` in `src/zoho/sprintsClient.ts`
  actively **throws** if more than one Zoho Sprints workspace is visible to the connected account. There's
  no concept of "which customer is this request for."
- **One `mcpApiKey` for the whole deployment.** Rotating it (re-running `oauth:setup`) invalidates every
  connected client at once - fine when "every connected client" means one person's Claude Code sessions,
  not workable once it means many customers' credentials.

None of this is a bug - it's the right set of simplifications for "one person's Lambda talking to their
own Zoho account," which is what this repo says it is. Everything below is what would have to change to
make it something else.

## What a real multi-tenant rebuild needs

1. **Replace Self Client with the standard Authorization Code Grant flow.** Register a proper
   (non-"Self Client") OAuth client in the Zoho API Console, with a real redirect URI. Build a
   `/oauth/authorize` → Zoho consent screen → `/oauth/callback` flow. Each customer clicks "Connect Zoho
   Sprints," approves scopes once, and you receive their refresh token server-side - no grant codes, no
   manual console visits per customer.
2. **A real per-tenant credential store.** Replace the single Secrets Manager secret with a table (e.g.
   DynamoDB) keyed by customer/user: `{customerId, zohoClientId?, refreshToken, teamId, dataCenter,
   mcpApiKey}`. The OAuth client itself (client ID/secret) is likely shared across all customers - only
   the refresh token, team, and data center are per-tenant.
3. **Per-request tenant resolution.** `getContext()` currently resolves one global `SprintsClient`. It
   would need to resolve a tenant from the incoming `Authorization: Bearer <token>` (look up which
   customer that token belongs to), then construct a `SprintsClient` scoped to that tenant's credentials.
   The lazy-loading and stateless-per-request design already in place (see CLAUDE.md) is actually a decent
   starting point for this - it's already "build fresh state per request," just currently from one config
   instead of a tenant lookup.
4. **Drop (or make optional) the single-workspace assumption.** Either let a customer pick which Zoho
   Sprints workspace/team to connect during onboarding, or support multiple.
5. **Onboarding/lifecycle.** Real signup, a way to disconnect/revoke, and (if listing in Zoho's own
   marketplace - see below) their install/uninstall/upgrade lifecycle hooks.
6. **Billing**, entirely separate from Zoho - see below.

None of this touches the actual Sprints API integration logic (`sprintsClient.ts`'s endpoint knowledge is
reusable as-is) - it's all auth, storage, and request-routing plumbing around it.

## What I found about Zoho Marketplace (confirmed vs. still open)

**Confirmed live** (browsed `marketplace.zoho.com` on 2026-09-22):

- There is a real "Sprints" category with ~15+ listed extensions (Bug Viewer, Jira sync, Google Drive,
  SharePoint, Notebook, viaSocket, Skyvia, Pipedream, Xero, etc.).
- **Every single one of them is listed Free.** The marketplace has "Buy Now" pricing elsewhere (e.g. some
  CRM extensions), so this isn't a platform limitation - it's a real, observed pattern that Sprints
  extensions specifically aren't monetized through Zoho's own storefront. Treat that as a signal, not
  proof: it may just mean nobody's tried, or that the audience is small.
- Zoho Sprints' own API docs (`apidoc.html`) have an "Extensions" section, and it describes something
  narrower than "any app that calls the REST API": extensions are invoked via
  `POST /team/{teamId}/extensions/{extensionId}/functions`, keyed by a `functionUuid`/`version` sourced
  from a `plugin-manifest.json`. That's Zoho's own plugin/function-execution framework (their "Zet"-style
  extension SDK used across Zoho products) - **not** the same thing as "a third-party server that
  authenticates with OAuth and calls the public REST API," which is what this repo is.

**Not confirmed - needs real research before committing to this path:**

- Whether an OAuth-based external service (no Deluge functions, no `plugin-manifest.json`, just a server
  calling the public REST API) can be listed in the Sprints marketplace category at all, or whether every
  listing there is required to be built on Zoho's extension SDK. The sidebar filter I saw included an
  "API-built integrations" vs. "Built-in integrations" deployment-type facet, which suggests a lighter,
  OAuth-only listing path might exist - but I didn't verify it. This needs someone to actually read Zoho's
  extension developer/publishing docs (I couldn't locate them by guessing URLs from
  `marketplace.zoho.com` - they're likely under a separate developer console/subdomain) or talk to Zoho
  directly.
- Revenue share, review process, timeline, and whether a paid listing is even permitted for Sprints
  specifically (every example I found was free).

**My honest read given what's confirmed:** the Zoho Marketplace looks built around Zoho's own in-product
extension framework, not around "any OAuth client that hits our REST API" - which is exactly what an MCP
server is. Before investing in that path, verify it's even the right shape of listing. The more natural
distribution channel for something that's fundamentally "an MCP server for Claude/AI agents," rather than
"a Zoho Sprints in-app plugin," is probably the emerging **MCP server directories** (Anthropic's own
connector directory, and third-party ones like Smithery, PulseMCP, Glama, mcp.so) rather than Zoho's
marketplace at all - positioned as "Zoho Sprints for AI agents," sold/distributed independently of Zoho,
with your own billing.

## If this gets picked up later

Start by resolving the two open questions above (can this be listed as an API-only integration, and is
paid even viable for Sprints) before doing any of the engineering work in the numbered list - they change
whether Zoho Marketplace is worth building for at all, versus going straight to an independent
multi-tenant SaaS distributed through the MCP ecosystem instead.
