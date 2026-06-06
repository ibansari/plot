# In-app MCP connections — design

**Date:** 2026-06-07
**Status:** Approved (design); pending implementation plan
**Scope owner:** Plot integrations (MCP connector catalog)

## Problem

The MCP *machinery* is fully functional end-to-end — verified live on 2026-06-07 against a
self-contained MCP server: `connect → discover (risk-classified) → read execute → mutation
preview → approve → execute → receipt`, on both the API gateway path and the agent `McpHub`
path. Repo gates pass (agent 4/4, API MCP specs 10/10).

But **no connection is functional *to the user***:

- The iOS `ConnectorDetailView` "Connect" button is a dead placeholder
  (`// connection flow … placeholder CTA`); the coverage badge is hardcoded
  "Needs account connection".
- There is **no user-facing connect API** — only `POST /internal/mcp/connect`, which requires
  the *caller* to supply a transport.
- The running API has **zero invokable MCP servers** (`PLOT_MCP_SERVERS` empty; confirmed
  `resy`/`ticketmaster`/`google-maps` all return `"MCP server '…' not connected"`).
- Two stale orphan `ConnectorConnection` rows (`resy`, `ticketmaster`) point at
  `npx @modelcontextprotocol/server-everything` with `health:"ok"` frozen at 2026-05-31 — they
  show phantom-healthy in the UI while being dead.

## Goal

Let a user connect a connector **from inside the app** and have it become genuinely functional:
the connection is persisted (group-scoped), its tools are discovered + risk-classified, live
health/coverage is shown, and the connector is invokable through the existing MCP gateway
(reads execute; mutations preview→approve).

## Decisions (locked during brainstorming)

1. **Connect mechanism:** bundled **mock MCP servers** — realistic canned data, zero external
   credentials or downloads, fully demoable now; swappable for real servers later by config.
2. **Functional depth:** *invokable + visible in app*. Connecting persists the connection,
   discovers tools, shows live health, and makes the connector invokable via the gateway/UI.
   **Feeding the agent planning loop is explicitly out of scope** (a later slice).
3. **Ownership:** **group-scoped** (`ownerScope=GROUP`); **any member** can connect/disconnect
   and all members see the state. Mutating-tool *approvals* still follow the existing per-risk
   policy (organizer for PURCHASE/IRREVERSIBLE).
4. **Implementation approach:** **Node stdio mock servers** using the already-vendored
   `@modelcontextprotocol/sdk`, driven by an API `ConnectorRegistry` and user-facing endpoints.
   (Rejected: Python FastMCP servers — couples API spawning to the agent venv path; in-process
   mock executor — bypasses the real MCP transport.)

## Architecture

```
iOS ConnectorDetailView "Connect"
   → POST /mcp/connectors/:key/connect { groupId }      (AuthGuard, membership-checked)
       → ConnectorRegistry.lookup(key)  ── transport {command:"node", args:[absPath, key]}
       → McpConnectionService.connectAndDiscover (UPSERT by catalogKey+groupId)
           → McpStdioExecutor.register + listTools   (spawns bundled mock server over stdio)
           → persist ConnectorConnection + ConnectorTool[] (risk + approvalPolicy per tool)
       → returns { connectionId, health, coverage, tools[] }

Invocation (unchanged):
   POST /internal/mcp/invoke → McpGatewayService.invoke
       read  → execute now            → READY envelope
       write → preview + approval     → NEEDS_APPROVAL → approve → execute → receipt
```

**New:** bundled mock servers, `ConnectorRegistry`, three endpoints, iOS client + UI.
**Reused as-is:** `McpStdioExecutor`, `McpGatewayService`, `McpRenderService`, approval
lifecycle, `ExternalActionApprovalSheet`.
**Lightly extended:** `McpConnectionService` (create → upsert by `catalogKey+groupId`).

## Component 1 — Bundled mock MCP servers

A single **parameterized** Node server avoids 6 near-identical files.

- `api/mcp-mock-servers/server.mjs` — entry: `node server.mjs <catalogKey>`. Builds an
  `McpServer` (from `@modelcontextprotocol/sdk/server/mcp.js`), registers the tools for
  `<catalogKey>` from `fixtures.mjs`, connects a `StdioServerTransport`
  (`@modelcontextprotocol/sdk/server/stdio.js`).
- `api/mcp-mock-servers/fixtures.mjs` — `catalogKey → [{ name, description, inputSchema,
  handler }]`, each handler returning realistic canned JSON.

Tool names are chosen so the **existing `classifyRisk(toolName)` heuristics** classify them
correctly with **no special-casing**:

| Connector        | Read tools                      | Mutating tool → risk (policy)        |
|------------------|---------------------------------|--------------------------------------|
| google-calendar  | `list_events`                   | `create_event` → WRITE (member)      |
| google-maps      | `search_places`, `directions`   | —                                    |
| resy             | `search_restaurants`            | `book_reservation` → HOLD (member)   |
| ticketmaster     | `search_events`                 | `buy_tickets` → PURCHASE (organizer) |
| flights          | `search_flights`                | `purchase_flight` → PURCHASE (organizer) |
| lodging          | `search_lodging`                | `book_stay` → HOLD (member)          |

`weatherkit` stays native (not an MCP connector) and is **not** connectable here.

Spawned via `node` (always on PATH). The registry resolves an **absolute** path to
`server.mjs` so the API process cwd is irrelevant.

## Component 2 — API `ConnectorRegistry` + endpoints

`api/src/integrations/mcp/connector-registry.ts`:
`catalogKey → { serverKey, transport: { transport:"stdio", command:"node", args:[absServerPath, key] }, mutating: string[] }`.
Absolute path via `path.join(__dirname, …)` resolved to the repo's `api/mcp-mock-servers/`.

Three endpoints on `McpController` (all `@UseGuards(AuthGuard)`, body `{ groupId }`, all verify
the caller is a `GroupMember` of `groupId` → `ForbiddenException` (403) otherwise):

- `POST /mcp/connectors/:key/connect` — registry lookup (unknown key → 404) →
  `connectAndDiscover` **upserted** by `catalogKey+groupId` → returns
  `{ connectionId, health, coverage, tools:[{name,risk,approvalPolicy}] }`.
- `GET /mcp/connectors?groupId=` — catalog entries merged with per-group connection state:
  `{ key, displayName, category, trustTier, sourceUrl, connection: { connected, health,
  coverage, toolCount } | null }`.
- `POST /mcp/connectors/:key/disconnect` — deletes the group's `ConnectorConnection` for
  `catalogKey` and its `ConnectorTool[]`.

**Dedup:** service-level upsert (find by `catalogKey+groupId`, update + recreate tools) rather
than a schema `@@unique` migration — avoids a migration against the live Supabase DB.

**Orphan cleanup:** a one-off removes the 2 stale `server-everything` rows
(`resy`, `ticketmaster`) so the UI stops showing phantom-healthy connectors; re-connecting via
the app recreates them mock-backed.

## Component 3 — iOS

- `IntegrationModels.swift`: add `ConnectorConnectionState { connected: Bool, health: String,
  coverage: String, toolCount: Int }` and a list DTO pairing `ConnectorEntry` + optional state.
- `APIClient.swift`: add `connectors(groupId:)`, `connect(key:groupId:)`,
  `disconnect(key:groupId:)`.
- `ConnectorCatalogView.swift`: load the merged `GET /mcp/connectors` endpoint; show a
  "Connected" indicator on connected rows.
- `ConnectorDetailView.swift`: replace the hardcoded badge + dead button with — live
  coverage/health badge; a working **Connect** button (spinner → success); a
  **Connected · N tools** state; a **Disconnect** action.

## Data flow, error handling, testing

- **Reads vs mutations:** unchanged. Gateway executes reads → `READY`; mutations →
  `NEEDS_APPROVAL` → existing `ExternalActionApprovalSheet` → approve → execute → receipt.
- **Errors:** mock server fails to spawn → `health:"down"`, `coverage:"degraded"`, UI shows a
  degraded badge + retry. Non-member → 403. Unknown catalog key → 404.
- **Testing:**
  - New `api/test/connectors.spec.ts` spins up a **real** bundled mock subprocess and asserts:
    connect → discover (`health:"ok"`, tools present, risk classified); read invoke → `READY`;
    mutating invoke → `NEEDS_APPROVAL` (not executed); disconnect → connection gone; non-member
    → 403; unknown key → 404.
  - Existing `mcp-gateway.spec.ts` / `mcp-render.spec.ts` stay green.
  - API typecheck (`tsc --noEmit`) clean.
  - iOS verified manually (build + connect a connector, observe Connected state + an invoke).

## Out of scope (explicit)

- Agent planning loop consuming DB-backed connections (still env-driven `PLOT_MCP_SERVERS`).
- Real provider OAuth / credential entry / live Google/Resy/Ticketmaster servers.
- Per-user (`ownerScope=MEMBER`) personal connections.
- Web client connector UI.
