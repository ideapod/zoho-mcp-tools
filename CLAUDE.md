# CLAUDE.md

Guidance for Claude Code sessions working in this repo. See [README.md](README.md) for user-facing docs.

## What this is

A remote MCP server, deployed as a Lambda container image, exposing Zoho Sprints backlog/kanban operations as
MCP tools for the StoryTrail project. Single-user, personal integration - no multi-tenancy, no other Zoho
products.

(Speculative, not-started: [docs/multi-tenant-marketplace-strategy.md](docs/multi-tenant-marketplace-strategy.md)
sketches what turning this into a sellable, multi-tenant product would take, and what's actually confirmed vs.
still unknown about listing in Zoho Marketplace. Don't build toward it without the user explicitly picking it
up - it contradicts several of the single-user decisions below.)

## Key decisions and why (don't relitigate without new information)

- **Zoho Wiki is out of scope.** It has no supported REST API (confirmed: `apihelp.wiki.zoho.com` returns
  "Workspace not found", no Wiki entry in Zoho's API directory). Don't add Wiki tools unless Zoho ships a real
  API and someone explicitly asks for it.
- **Story Trail is a pure Kanban board, not Scrum - don't build sprint CRUD tooling for it.** Confirmed live via
  `get_project_metadata` (exactly 3 statuses: To do/In progress/Done, no sprint-related config) and `list_sprints`
  (returns `[]` - no sprints ever created, since `list_sprints`' `type` filter only asks for types 1-4, the
  Scrum sprint states - see the next bullet for what it's missing). `list_sprints` stays in the tool surface
  since it's cheap and harmless, but resist the temptation to add create/start/complete/delete-sprint or
  move-item-to-sprint tools unless a genuinely Scrum project shows up - they'd have nothing real to operate on
  and nobody to exercise them. (Raised and self-corrected by the user on 2026-09-22 after asking for exactly
  this, then noticing `list_sprints` came back empty.)
- **Kanban status moves (`move_item_status`) are genuinely more involved than a plain field update, and none of
  it is documented.** All of the following was confirmed live on 2026-09-22 - most of it only by capturing the
  real network request the Zoho Sprints web app itself fires when you drag a card (apidoc.html has no
  "move status" or "Kanban board" endpoint at all):
  - A brand-new item starts in the literal "backlog" pseudo-sprint (`getProjectBacklogId`,
    `sprintType: 5`, name `"Backlog"`). The plain `Update item` endpoint flatly refuses a `statusid`
    change there: `HTTP 500 {"code":7500.6,"message":"Status update not supported in backlog."}` -
    even though apidoc.html lists `statusid` as a normal, unrestricted `Update item` parameter.
  - Every Kanban project has a second, *also entirely undocumented* pseudo-sprint - a "Kanban Board"
    (`sprintType: 7`). apidoc.html's "Get items" section claims this ID ("`kanbanBoardId`") comes from
    `Get Project Details` - it doesn't; that field is genuinely absent from that response (checked both
    `x-convert-response`-converted and raw). The only way to find it is `Get sprints` with the undocumented
    `type=[7]` filter (now wrapped in `SprintsClient.getKanbanBoardId`, cached per project since it never
    changes).
  - An item's first status change has to move it from the backlog onto that board, via the documented "Move
    item" bulk endpoint (`action=moveitem`) - but with two fields apidoc.html doesn't mention: `statusid`
    (the target status) and `needlrvalidation` (`true`), both captured from the real drag-and-drop request.
    `tosprintid` must be the Kanban board ID; the URL's `{sprintId}` segment must exactly match the item's
    *actual current* container or Zoho rejects it (`HTTP 500 {"code":7500.6,"message":"Item(s) to be moved
    mismatch with the current sprintId!"}`); and it refuses a same-container "move" outright (`HTTP 500
    {"code":7500.6,"message":"Item(s) are already in the selected/current sprint"}`).
  - Once an item is on the board, further status changes go through the plain `Update item` endpoint again,
    normally - the backlog restriction really is specific to the literal backlog container, not "Kanban
    projects" as a whole.
  - To find an item's *actual* current container without the caller having to track it: `Get item details`
    does **not** validate its URL's `{sprintId}` segment against the item's real location (unlike `Update
    item`/`bulkupdate`, which both do) - it just returns the item's true data regardless of which container ID
    you queried with, including its real `sprintId` field. `SprintsClient.moveItemStatus` uses exactly this: one
    `getItem` call against the board ID, then reads `sprintId` off the response to decide whether to call plain
    `updateItem` or the `bulkupdate`/`moveitem` dance. (An earlier version of this tried a try/catch "does
    `getItem` succeed against the board" existence probe instead - don't do that, it always "succeeds"
    regardless of where the item actually is, since `getItem` doesn't check the container either way.)
  - All of this is encapsulated in `SprintsClient.moveItemStatus`; the `move_item_status` tool in
    `src/mcp/tools/backlog.ts` just delegates to it. If you ever touch this again, re-read that method's doc
    comment before changing anything - the ordering (bulkupdate for backlog, plain update once on the board) and
    the "don't re-validate location with getItem-as-probe" note both matter.
- **The same backlog/board split above also broke *listing/discovery*, not just status moves - `list_backlog_items`
  now scans every container by default.** Confirmed live 2026-09-22: a working session searched the Story Trail
  board for two specific cards ("org switcher", "AR turn-by-turn nav") across all statuses and epics, full-text,
  and came back empty - and concluded the cards didn't exist and nearly recreated them. They existed the whole
  time, already `In progress`, with accurate content - `list_backlog_items` (and `get_item`/`update_item`/
  `update_item_tags` defaulting `sprintId` to the backlog) only ever looked at the literal Backlog pseudo-sprint,
  and both cards had already had their first status change and moved onto the separate Kanban Board pseudo-sprint
  (see the bullet above). `list_sprints` couldn't have caught this either - it only surfaces Scrum sprint types
  1-4, and the Kanban board is the undocumented type 7, so a Kanban project's second container is invisible to
  every enumeration tool that existed before this fix.
  - Fixed by adding `SprintsClient.getAllContainerIds`/`listAllItems`, which discover every container a project
    actually has - the Backlog, the Kanban board if `getKanbanBoardId` finds one, and every real sprint via
    `listSprints` (type 1-4) - and merge items across all of them. `list_backlog_items` now calls this by default;
    passing `sprintId` still scopes to just that one container (e.g. to deliberately list only the Backlog).
  - **This generalizes to genuine Scrum sprints too, not just Kanban's board** - if this workspace ever starts
    using real sprints, an item that's been moved into sprint 5 is exactly as invisible to a backlog-only query as
    a Kanban card on the board was. `listAllItems` already covers that case (it merges in every sprint
    `listSprints` returns, not just the Kanban board), but it hasn't been exercised live against an actual Scrum
    project with real sprints - only against Story Trail, which is Kanban-only (see the "pure Kanban" bullet
    above). If you touch this once a real Scrum project shows up, verify it actually finds sprint-contained items
    live rather than trusting this untested-for-Scrum path.
  - Also fixed a related but distinct bug: `update_item`/`update_item_tags` defaulted a bare `itemId` to the
    backlog container exactly like `list_backlog_items` did, but unlike `get_item` (which is never validated
    server-side, per the bullet above) `Update item` *does* validate its URL's `{sprintId}` segment and rejects a
    mismatch - so updating a card that had already moved to the board without knowing to pass the board's
    `sprintId` would fail outright. Both tools now call `SprintsClient.resolveItemContainerId`, which probes via
    `getItem` (unvalidated, so any container ID reaches the truth) to find the item's real current container
    before mutating it, unless the caller already supplies `sprintId`. `get_item` deliberately keeps defaulting to
    the backlog ID without resolving anything first - it doesn't need to, since that endpoint isn't validated
    either way.
  - One real cost of the fix: `listAllItems` is one HTTP call per container, run every time `list_backlog_items`
    is called without `sprintId`. Fine at this workspace's item/sprint volumes; would get slow on a project with
    many historical sprints.
- **Backlog/sprint item reordering (drag-to-reorder rank within the list) is a confirmed dead end - don't build a
  `move_item_position`-style tool for it.** apidoc.html has nothing for it (its "Move item" endpoint,
  `bulkupdate` + `action=moveitem`, moves items *across* sprints/projects, not within one - no position param at
  all). Captured the real request the Zoho Sprints web app fires when dragging a backlog card (2026-09-22): `POST
  {webAppHost}/zsapi/team/{teamId}/projects/{projectId}/sprints/{sprintId}/?action=updateitemsprintorder`, body
  `{position, itemidarr}` (`position` is a 0-based target index in display order, confirmed by observation - drag
  to display index 3 sent `position=3`). Tried it against the public OAuth API host
  (`ZOHO_API_BASE_URL`/`sprintsapi.zoho.<dc>`) with the normal `Zoho-oauthtoken` bearer auth this whole codebase
  otherwise uses - it fails every time with `HTTP 400 {"code":7600,"message":"Browser cookies disabled"}`, and
  that's not a form-encoding artifact (form-urlencoded and multipart/form-data bodies both got the identical
  error) or a wrong-host artifact (pointing `ZOHO_API_BASE_URL` at the web app's own host,
  `sprints.zoho.<dc>/zsapi`, instead of the API host got the identical error too). Conclusion: unlike the Kanban
  move mechanism above, this action is gated on an actual browser session (cookies + the `X-ZCSRF-TOKEN`/
  `CT_CSRF_TOKEN` headers the captured request carried) and Zoho does not accept OAuth bearer auth for it at all
  - it's an internal web-client action, not part of the public API surface, no matter which host or encoding you
  throw at it. Don't re-attempt this without a genuinely new angle (e.g. if Zoho ever documents a real reorder
  endpoint) - re-deriving the same negative result from scratch means replaying this whole investigation,
  including a live drag capture from the user.
- **Built from scratch, not forked from an existing OSS Zoho Sprints MCP server.** Several exist on GitHub
  (e.g. `dineshkanin/zoho-sprints-mcp`) but are unaudited third-party code that would hold real OAuth credentials
  to production data. This repo's tool surface is intentionally smaller (10 tools vs. 100+) and fully owned/auditable.
- **Self Client OAuth flow**, not a full authorization-code redirect flow. Appropriate because this is a personal,
  single-user integration - no need for a consent screen or redirect URI.
- **Least-privilege OAuth scopes only** - see `REQUIRED_SCOPES` in `scripts/oauth-setup.ts`. Don't request
  broader scopes (e.g. `.DELETE`, `.ALL`) than a tool actually needs; add a scope only when you add a tool that
  needs it.
- **Lambda + Function URL + container image + AWS Lambda Web Adapter**, not a hand-rolled Lambda event
  adapter, not API Gateway, not EC2/Fargate. See the README's Architecture section for the full justification.
  The upshot: `src/server.ts` is a normal `node:http` server with zero Lambda-specific code, which is the point -
  keep it that way. Don't add `exports.handler`-style Lambda code; if the deployment model ever needs to change,
  change the adapter/infra, not the app.
- **Image platform is pinned to `linux/arm64`** in `infra/lib/zoho-mcp-stack.ts` (`Platform.LINUX_ARM64` +
  `Architecture.ARM_64`), matched together deliberately. If you ever change one, change the other - a mismatch
  produces `Extension.LaunchError: ProcessSpawnFailed` in CloudWatch Logs with almost no other diagnostic
  information (this bit us once during initial deploy: the function defaulted to x86_64 while the image was
  built arm64 on an Apple Silicon dev machine).
- **Config loading is lazy** (`getContext()` in `src/server.ts`), not done at server startup. The HTTP server
  must always bind its port and answer `/health` immediately, even if Secrets Manager is unreachable or the
  secret is an empty/invalid placeholder (e.g. right after a fresh deploy, before `oauth:setup` has run) -
  otherwise the Lambda Web Adapter's readiness check fails and the whole function is reported broken instead of
  "up, but not configured yet". Don't reintroduce eager config loading in the server constructor.
- **MCP transport is stateless** (`sessionIdGenerator: undefined`, fresh `McpServer`/transport per request). This
  is required for a serverless deployment - don't switch to stateful sessions without also solving where session
  state would live across Lambda invocations.
- **`/mcp` only accepts POST** - `src/server.ts` rejects GET/DELETE with an immediate 405. The MCP SDK's
  streamable-HTTP transport also supports a standalone GET that opens a long-lived SSE stream for
  server-initiated notifications, closed only when the app calls `transport.closeStandaloneSSEStream()` on that
  same transport instance later. Because this server builds a fresh, stateless transport per request and never
  keeps a reference to it afterward, nothing can ever close that stream - accepting a GET would leave the
  connection open until Lambda's own timeout kills it. This actually happened: on 2026-09-20 a well-behaved MCP
  client opened that stream (to listen for notifications this server never sends), it hung for the full 30s,
  the client immediately reopened it on disconnect, and that loop ran continuously - confirmed live via
  CloudWatch Logs (tens of thousands of invocations, hundreds of thousands of the 400k monthly free-tier
  Lambda-GB-second limit by the time it was caught, which is what triggered an AWS billing alert). Don't remove
  the POST-only check without first solving how a per-request transport would ever close a stream it can no
  longer reach. See the README's "Checking Lambda usage/cost" section for how to check this isn't recurring -
  CloudWatch Logs Insights for real-time health, Cost Explorer/`aws freetier get-free-tier-usage` for billing
  (which lags up to ~24h, so don't use it alone to judge whether something is happening *right now*).
- **Deploys can happen from two places**: a developer's local `npm run cdk -- deploy` and GitHub Actions on push
  to `main` (see README's CI/CD section). Both update the same CloudFormation stack, so the latest commit on
  `main` isn't necessarily what's live - check `aws cloudformation describe-stacks --stack-name
  ZohoSprintsMcpStack --query 'Stacks[0].LastUpdatedTime'` (or the Lambda's `LastModified`) against `git log` if
  you need to know what's actually deployed. Deploying locally right after pushing (so CI's deploy job is also
  about to run) races both `cdk deploy`s for the same CloudFormation update lock; the loser fails with an opaque
  CDK error that has nothing to do with the code - if that happens, just check the stack is `UPDATE_COMPLETE`
  and move on rather than debugging it as a regression.
- **App-level bearer token auth on `/mcp`**, not AWS IAM auth on the Function URL. A remote MCP client can't do
  SigV4 request signing, so `authType: NONE` on the Function URL is intentional, compensated for by the
  `Authorization: Bearer <mcpApiKey>` check in `src/server.ts`. Don't remove this check without adding an
  equivalent.
- **Credentials only ever live in AWS Secrets Manager or a git-ignored `.env`.** Never hardcode them, never log
  them, never put them in CDK context/outputs.
- **Region is pinned to `ap-southeast-2`** in `infra/bin/app.ts`, deliberately ignoring the deployer's default
  AWS CLI region/profile (Zoho's API is reached over the public internet regardless of Lambda's region).
- **Don't assume the `.com` (US) Zoho data center.** `resolveDataCenter()` in `scripts/oauth-setup.ts` maps a
  user-supplied DC (accepting several input formats - bare suffix, `zoho.<suffix>`, a full host, Canada's
  irregular `zohocloud.ca`) to its `accountsBaseUrl`/`apiBaseUrl`, and both get written into the Secrets Manager
  secret alongside the credentials. `src/config.ts` resolution order is: explicit env var > value stored in the
  secret > hardcoded `.com` default. This bit us once already - a user who was actually on `.com.au` got sent
  `accounts.zoho.zoho.com.au` (DNS failure) because the original script only asked for a bare suffix and
  string-concatenated it blindly. If you touch DC handling again, keep accepting loose input formats and keep
  writing both URLs into the secret, not just `accountsBaseUrl`.
- **`scripts/oauth-setup.ts` generates a brand-new random `mcpApiKey` every time it's run**
  (`randomUUID() + randomUUID()`, not read back from the existing secret) and overwrites whatever was there.
  Re-running `oauth:setup` for any reason (rotating DC settings, redoing the OAuth grant, etc.) silently
  invalidates every already-configured MCP client's `Authorization: Bearer <token>` header, since it no longer
  matches the secret. This bit us on 2026-09-22: an `oauth:setup` re-run rotated the secret (confirmed via
  `aws secretsmanager describe-secret --secret-id zoho-sprints-mcp/zoho-credentials --query LastChangedDate`),
  and a Claude Code session's cached header in `~/.claude.json`
  (`mcpServers.zoho-sprints.headers.Authorization`) started failing with 401s that looked like a server-side
  auth bug. After any `oauth:setup` run, update every MCP client's Authorization header to match the new
  `MCP_API_KEY` written to local `.env` - and note a client only picks up a `~/.claude.json` edit on a brand-new
  session, not a retry inside one that's already connected. Two more `oauth:setup` gotchas found 2026-09-22
  adding `epic.DELETE`: (1) Zoho's Self Client "Generate Code" tab can silently keep a **previously entered**
  scope string instead of the one the script just printed - a re-run that added a scope to `REQUIRED_SCOPES`
  produced a token that still lacked it, confirmed by the new token working fine for already-granted scopes
  (`epic.READ`) but failing the new one (`HTTP 401 {"code":7601,"message":"Invalid oauthscope"}` on
  `epic.DELETE`) - always double check the exact scope string pasted into Zoho's console matches current
  `REQUIRED_SCOPES` verbatim. (2) The script pauses mid-run on an interactive prompt ("Push these credentials to
  AWS Secrets Manager now?") - if that's left unanswered, the run is incomplete and nothing's actually rotated
  yet; don't assume a rotation happened just because the script was invoked; check
  `aws secretsmanager describe-secret ... --query LastChangedDate` and local `.env`'s mtime to confirm it
  actually finished. A currently-connected Claude Code session's `mcp__zoho-sprints__*` tools are also
  unaffected by tools added after that session's `tools/list` was cached (e.g. a session that connected before
  `delete_epic` existed won't see it via `ToolSearch` either, separately from the bearer-token staleness above)
  - the local dev server (`node dist/src/local.js` with `.env` sourced) is the reliable way to exercise a
  brand-new tool or a freshly rotated scope without needing a new session.

## Build quirk to know about

`tsconfig.json` has `rootDir: "."` and includes `src`, `scripts`, and `test`, so `tsc` output mirrors that
structure: the compiled entrypoint is `dist/src/local.js`, **not** `dist/local.js`. `package.json`'s `start`
script and the `Dockerfile`'s `CMD` both already account for this - if you add a new entrypoint, remember the
`dist/src/...` prefix.

## Working in this repo

- Run `npm run lint && npm run typecheck && npm test` before considering a change done. All three are fast
  (no real network calls - tests mock `fetch`).
- Adding a new Sprints API capability: extend `src/zoho/sprintsClient.ts` with a typed method, then add/extend a
  tool in `src/mcp/tools/`, then register it in `src/mcp/server.ts`. Look up the exact endpoint/params on
  https://sprints.zoho.com/apidoc.html rather than guessing - the docs are inconsistently structured (e.g. some
  scopes like `ZohoSprints.comments.*` aren't listed in the overview scope table but are required by specific
  endpoints; parameter tables for endpoints like `Create item`/`Update item` are the actual source of truth for
  field names like `projitemtypeid`/`statusid`, not the prose description).
- Name/ID resolution for statuses, epics, item types, and priorities goes through `resolveEntityId` in
  `src/mcp/tools/helpers.ts` (exact name match, falling back to a unique substring match). Reuse it for any new
  tool that takes a human-readable name instead of a numeric Zoho ID.
- Don't add tools beyond backlog/kanban management (items, statuses, epics, sprints, comments) without checking
  with the user first - this is intentionally scoped to StoryTrail's kanban workflow, not full Sprints API
  coverage.
- After changing `Dockerfile` or `infra/lib/zoho-mcp-stack.ts`, verify locally before pushing:
  `docker build -t zoho-sprints-mcp:test .` then `docker run -p 8081:8080 -e ZOHO_CLIENT_ID=dummy -e
  ZOHO_CLIENT_SECRET=dummy -e ZOHO_REFRESH_TOKEN=dummy zoho-sprints-mcp:test` and curl `/health` and `/mcp`.
  This won't catch the Lambda-adapter-specific `ProcessSpawnFailed` failure mode above (that only manifests
  inside real Lambda) - after any architecture/platform-related change, do a real `cdk deploy` and curl the
  Function URL before calling it done.
