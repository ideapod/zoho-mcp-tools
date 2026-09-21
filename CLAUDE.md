# CLAUDE.md

Guidance for Claude Code sessions working in this repo. See [README.md](README.md) for user-facing docs.

## What this is

A remote MCP server, deployed as a Lambda container image, exposing Zoho Sprints backlog/kanban operations as
MCP tools for the StoryTrail project. Single-user, personal integration - no multi-tenancy, no other Zoho
products.

## Key decisions and why (don't relitigate without new information)

- **Zoho Wiki is out of scope.** It has no supported REST API (confirmed: `apihelp.wiki.zoho.com` returns
  "Workspace not found", no Wiki entry in Zoho's API directory). Don't add Wiki tools unless Zoho ships a real
  API and someone explicitly asks for it.
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
