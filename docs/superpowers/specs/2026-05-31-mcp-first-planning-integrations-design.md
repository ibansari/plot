# MCP-First Planning Integrations Design

## Goal

Make Plot an integration-first planning app that fits naturally into a group chat. Plot should
quietly gather useful facts, explain trade-offs in human terms, preview consequential actions, and
execute approved work without exposing private member data or provider-specific complexity.

The product must remain flexible enough to add official, partner, and community MCP servers without
building a bespoke backend module for every provider. Native Google Maps is the first deeply
integrated experience because location feasibility affects nearly every in-person plan.

## Product Decisions

- Use an MCP-first extension model. Dynamically discovered MCP tools remain agent-callable.
- Keep a small mandatory Plot gateway around every MCP call for credentials, permissions, risk,
  approval, audit, health, and graceful fallback.
- Build a schema-driven rendering layer. Unknown MCP results render as coherent generic cards;
  high-value capabilities progressively gain richer Plot-native views.
- Build Google Maps as a first-class product surface with direct Google SDKs and APIs rather than an
  archived reference MCP server.
- Use named travel ETAs with private origins. The group may see `Jordan - 34 min`, but never
  Jordan's saved address or current coordinates.
- Support saved starting areas with optional per-plan current-location overrides.
- Apply travel guardrails softly by default. A member may mark a limit hard, in which case violating
  venues are removed before the draft card appears.
- Support personal member connectors and optional group connectors.
- Use global best-effort coverage. The UI must state when a capability is unavailable or degraded.
- Allow broad marketplace MCPs to transact after runtime validation.
- Paid actions require organizer approval. Free holds require any member approval.
- Irreversible actions are allowed only after a clear warning that Plot cannot undo them.

## Existing Patterns

- `api/src/integrations/integrations.types.ts` defines provider seams with required permission
  scopes and graceful degradation.
- `api/src/integrations/integrations.service.ts` default-denies missing permissions.
- `agent/plot_agent/tools.py` gates tools before invocation.
- `agent/plot_agent/mcp_bridge.py` dynamically discovers MCP tools and registers them into the same
  agent loop registry.
- `api/src/common/audit.service.ts` records external actions and compensating undo descriptors.
- `ios/Plot/Views/DecisionCardView.swift` already renders plan options, vote state, lock state, and
  RSVP state.

The design extends these patterns instead of replacing them.

## Architecture

```text
Group chat and native app
        |
        +-- Native Maps planning surface
        |     Places search and details
        |     Route matrix and fairness scoring
        |     Private origin controls
        |     Google Maps directions handoff
        |
        +-- Generic integration surfaces
              Connector settings
              MCP result cards
              Approval previews
              Receipts and fallback links
        |
        v
Plot integration API
        |
        +-- Native provider adapters
        |     Google Places API
        |     Google Routes API
        |     Google Calendar API
        |     WeatherKit REST API
        |
        +-- Plot MCP gateway
              Curated connector catalog
              Per-member and per-group credentials
              Dynamic tool discovery
              Capability metadata and display hints
              Permission and risk gates
              Approval lifecycle
              Result normalization
              Health and audit
        |
        v
Official, partner, and community MCP servers
```

### Native Maps Boundary

Use direct Google APIs for the stable location core:

- Maps SDK for iOS renders the embedded map.
- Places SDK for iOS powers native autocomplete where useful.
- Places API web service powers server-side venue discovery and detail enrichment.
- Routes API `computeRouteMatrix` compares member origins against candidate venues.
- Routes API `computeRoutes` supports selected-route detail when needed.
- Google Maps URLs hand off locked plans for turn-by-turn navigation.

Google recommends place IDs for route waypoints. Plot should store Google place IDs and coordinates
for candidate venues and private member origins. Route matrix responses require Google attribution
when displayed.

Native Maps is not routed through MCP because it needs predictable latency, explicit field masks,
cost control, privacy review, and a polished iOS interaction model. A Google Maps MCP may still be
connected for agent research beyond the core location workflow.

### MCP Gateway Boundary

The gateway is deliberately thin. It does not force every provider into a large planning taxonomy.
It wraps dynamic MCP calls with product-grade safety and rendering metadata.

Every MCP server has:

- identity, display name, description, trust tier, category, and source URL;
- transport configuration and encrypted credential references;
- owner scope: `MEMBER` or `GROUP`;
- connection health and last successful probe;
- declared tool overrides for risk, permissions, approvals, and renderer hints.

Every discovered tool has:

- MCP server tool name and input schema;
- read or mutate classification;
- risk: `READ`, `WRITE`, `HOLD`, `PURCHASE`, or `IRREVERSIBLE`;
- required Plot permission scopes;
- approval policy;
- optional renderer hint;
- optional fallback URL behavior;
- health and coverage status.

Unknown tools remain usable:

- unknown read tools may run only after the relevant connector is enabled;
- unknown mutating tools require a preview and explicit approval;
- unknown paid or irreversible tools require organizer approval;
- the UI renders unknown results with the generic renderer.

### UI Rendering Envelope

MCP responses must never spill raw JSON into chat. The API stores and emits a rendering envelope:

```ts
type IntegrationRenderEnvelope = {
  id: string;
  serverId: string;
  toolName: string;
  capability?: string;
  renderer: "GENERIC" | "LIST" | "COMPARISON" | "MAP" | "WEATHER" |
    "SCHEDULE" | "ITINERARY" | "APPROVAL" | "RECEIPT";
  title: string;
  summary?: string;
  freshness?: string;
  attribution?: { label: string; url?: string }[];
  fields?: { label: string; value: string }[];
  items?: {
    id?: string;
    title: string;
    subtitle?: string;
    fields?: { label: string; value: string }[];
    links?: { label: string; url: string }[];
  }[];
  links?: { label: string; url: string }[];
  actions?: {
    id: string;
    label: string;
    style: "PRIMARY" | "SECONDARY" | "DESTRUCTIVE";
    approvalId?: string;
  }[];
  risk?: "READ" | "WRITE" | "HOLD" | "PURCHASE" | "IRREVERSIBLE";
  status: "READY" | "DEGRADED" | "NEEDS_APPROVAL" | "FAILED";
};
```

Rendering enhancement ladder:

1. `GENERIC`: safe key-value, list, link, media, freshness, attribution, and error cards.
2. Connector hints: MCP catalog metadata selects list, comparison, or approval renderers.
3. Plot capability renderers: maps, schedules, weather, itineraries, comparisons, and receipts.
4. Native interactive workflows: group travel map and location preference editing.

## Native Maps Product Flow

### Member Origin Setup

Each member may:

- save a starting area using Google Places autocomplete;
- choose a preferred travel mode: drive, transit, walk, bicycle, or auto;
- set a soft maximum ETA;
- mark the ETA limit hard;
- optionally set transit preferences such as fewer transfers or less walking;
- use a one-off current-location override for a specific plan.

Persist coordinates and place IDs privately. Shared plan payloads expose only member name, travel
mode, duration, distance, and guardrail status.

### Candidate Research

When Plot drafts venue options:

1. Search Google Places using the planning intent and an appropriate search area.
2. Fetch only the fields required by the UI and booking fallback.
3. Compute a route matrix for private member origins x candidate destinations.
4. Score each candidate:
   - median ETA;
   - maximum ETA;
   - ETA spread;
   - number of soft guardrail warnings;
   - number of hard guardrail failures;
   - repeat-burden penalty when the same member is repeatedly the outlier.
5. Remove hard-failure venues.
6. Annotate soft warnings.
7. Rank socially fair options before the draft card is posted.

### Chat and iOS UI

The draft card should show:

- group ETA range;
- named ETAs for each member;
- soft warning badges;
- `View map`;
- `Meet halfway`;
- optional travel-mode toggle.

The native map should show:

- candidate venue pins;
- selected venue details;
- member ETA list without origin markers;
- fairness score and warning count;
- fit rationale;
- `Add to draft` or `Start vote`;
- `Open in Google Maps` after lock.

The map must not display member home pins, saved-area pins, or current-location pins to other group
members.

## Connector Catalog

The catalog is curated but extensible. Initial categories:

### Core Coordination

- Google Calendar: OAuth, free/busy read, event creation after lock.
- Google Maps: native Places and Routes foundation plus optional Maps MCP research.
- WeatherKit: venue/time forecast, severe-weather warnings, outdoor-plan fallback.
- Transit MCPs: richer local transit context where available.

### Going Out

- Restaurant reservation MCPs.
- Event discovery and ticket MCPs.
- Local activity and venue MCPs.

### Trips

- Flights MCPs.
- Lodging MCPs.
- Gmail itinerary extraction.
- Google Drive itinerary and shared document resources.
- Route-along-search for trip stops.
- Expense and receipt resources.

Coverage is best-effort globally. Every connector and action shows one of:

- available;
- degraded with fallback;
- unavailable in this market;
- needs account connection;
- needs approval.

## Transaction Lifecycle

External mutations use an approval lifecycle:

```text
Agent proposes tool call
  -> gateway validates connector, credentials, schema, and health
  -> gateway creates action preview
  -> UI renders provider, item, total, policy, risk, and fallback
  -> authorized member approves
  -> gateway executes MCP tool
  -> gateway stores receipt, confirmation, and cancellation capability
  -> Plot posts a socially readable confirmation
```

Approval rules:

- read-only calls: no per-call approval after connector enablement;
- writes such as calendar event creation: explicit member or group permission;
- free holds: any member may approve;
- paid actions: organizer approval;
- irreversible actions: organizer approval plus an explicit cannot-undo warning.

If cancellation is unavailable, the approval UI must state that Plot cannot undo the action and link
the provider's policy. If execution fails after approval, Plot reports the provider response and
offers a deep-link fallback where possible.

## Privacy and Credential Rules

- Encrypt connector credentials at rest.
- Never write raw credentials into audit payloads, chat metadata, or MCP render envelopes.
- Keep member connectors member-scoped and group connectors group-scoped.
- Store private origin coordinates separately from group-visible plan DTOs.
- Log routing summaries, not raw member origins.
- Require explicit current-location consent per plan override.
- Expire current-location overrides after the plan completes or is cancelled.

## Data Model Additions

Create Prisma models:

- `MemberTravelPreference`
  - member or contact identity, saved place ID, encrypted/private coordinates, label, mode, soft
    limit, hard-limit flag, transit preferences.
- `PlanTravelOverride`
  - plan and member identity, encrypted/private coordinates, expiry.
- `PlanOptionTravelSummary`
  - plan option, median ETA, max ETA, spread, fairness score, warnings, per-member named ETA JSON.
- `ConnectorCatalogEntry`
  - curated connector metadata, trust tier, category, renderer hints.
- `ConnectorConnection`
  - catalog entry, owner scope, encrypted credential reference, health, coverage.
- `ConnectorTool`
  - discovered MCP tool metadata, risk, permission scopes, approval policy, renderer hint.
- `IntegrationInvocation`
  - actor, server, tool, sanitized input, sanitized output, status, render envelope, timing.
- `ExternalActionApproval`
  - invocation, approver policy, preview, state, approved actor and time.
- `ExternalActionReceipt`
  - invocation, provider confirmation, policy URL, cancellation capability, fallback URL.

## API Modules

### Create

```text
api/src/integrations/maps/google-places.provider.ts
api/src/integrations/maps/google-routes.provider.ts
api/src/integrations/maps/maps.types.ts
api/src/integrations/maps/maps.service.ts
api/src/integrations/maps/maps.controller.ts

api/src/integrations/mcp/mcp-catalog.service.ts
api/src/integrations/mcp/mcp-connection.service.ts
api/src/integrations/mcp/mcp-gateway.service.ts
api/src/integrations/mcp/mcp-render.service.ts
api/src/integrations/mcp/mcp.controller.ts
api/src/integrations/mcp/mcp.types.ts

api/src/integrations/weather/weatherkit.provider.ts
```

### Modify

```text
api/src/integrations/integrations.module.ts
  Register Maps, MCP gateway, and weather providers.

api/src/integrations/integrations.service.ts
  Add venue feasibility enrichment and connector orchestration.

api/src/plan/plan.service.ts
  Attach travel summaries to draft options and action receipts to plans.

api/src/common/config.ts
  Add Google Maps, Routes, WeatherKit, encryption, and MCP gateway configuration.

db/prisma/schema.prisma
  Add private travel, connector, invocation, approval, and receipt models.
```

## Agent Modules

### Modify

```text
agent/plot_agent/mcp_bridge.py
  Move from environment-only dynamic tools toward API-backed catalog connections while retaining
  environment configuration for development.

agent/plot_agent/tools.py
  Route external mutations through preview and approval instead of raising a generic block.

agent/plot_agent/loop.py
  Summarize render envelopes, health failures, approvals, and receipts.

agent/plot_agent/api_client.py
  Add Maps feasibility and MCP gateway endpoints.
```

The agent should use native Maps feasibility tools for normal venue planning. MCP Maps tools remain
available for broader research.

## iOS Modules

### Create

```text
ios/Plot/Views/Map/PlanMapView.swift
ios/Plot/Views/Map/PlanMapViewModel.swift
ios/Plot/Views/Map/TravelPreferenceView.swift
ios/Plot/Views/Integrations/ConnectorCatalogView.swift
ios/Plot/Views/Integrations/ConnectorDetailView.swift
ios/Plot/Views/Integrations/IntegrationResultCard.swift
ios/Plot/Views/Integrations/ExternalActionApprovalSheet.swift
ios/Plot/Models/IntegrationModels.swift
```

### Modify

```text
ios/Plot/PlotApp.swift
  Initialize Google Maps and Places SDK keys.

ios/Plot/Views/DecisionCardView.swift
  Show ETA summaries, travel warnings, map expansion, and directions handoff.

ios/Plot/Views/MainTabView.swift
  Add connector settings entry point.

ios/Plot/Networking/APIClient.swift
  Add travel preference, Maps, connector, approval, and receipt endpoints.

ios/project.yml
  Add Google Maps and Places Swift packages and location usage descriptions.
```

## Web Guest Surface

Modify `web/app/v/[token]/page.tsx` so guest invite links can:

- show named travel ETA summaries without origins;
- collect a simple travel-mode and maximum-ETA preference;
- show provider handoff links after lock;
- show generic receipt and status cards for actions involving the guest.

## Build Slices

### Slice 1: Native Maps and Travel Equity

- Google Places search and details.
- Routes matrix.
- Private origins and one-off current-location overrides.
- Travel guardrails and fairness scoring.
- Draft ETA annotations.
- Expandable iOS map and directions handoff.

### Slice 2: MCP Gateway and Generic Renderer

- Catalog, connection, tool, invocation, approval, and receipt persistence.
- Dynamic MCP discovery through the gateway.
- Generic render envelopes and iOS cards.
- Connector settings, health, trust, and coverage states.
- Preview and approval sheets for external mutations.

### Slice 3: Core Coordination Pack

- Google Calendar OAuth and free/busy.
- Calendar write after lock.
- WeatherKit.
- Transit enrichment.
- Reminders.

### Slice 4: Going-Out Pack

- Reservation MCPs.
- Events and ticket MCPs.
- Holds, purchases, receipts, policy links, and cancellation paths.

### Slice 5: Trips Pack

- Flights, lodging, itinerary resources, Drive documents, Gmail extraction, route-along-search, and
  expense resources.

## Error Handling

- Provider timeout: return degraded status and preserve the chat flow.
- Partial route matrix: score available routes and mark unknown member ETAs clearly.
- Missing permission: explain the missing connector or scope without exposing private data.
- Unsupported geography: render unavailable-market state and fallback links.
- MCP schema mismatch: store failed invocation, do not execute, and show a connector health issue.
- Transaction ambiguity: never retry automatically unless the provider offers an idempotency key.
- Post-approval failure: record failure and provide provider handoff when possible.

## Testing

### API

- Google Places maps only requested fields.
- Routes matrix never serializes member origins.
- Fairness scoring removes hard violations and annotates soft warnings.
- Current-location overrides expire.
- MCP gateway discovers tools and applies trust overrides.
- Unknown MCP reads produce generic envelopes.
- Mutations create previews before execution.
- Paid and irreversible actions require organizer approval.
- Free holds accept member approval.
- Credentials and origins never enter audit payloads.
- Transaction retries require provider idempotency.

### Agent

- Venue drafting uses Maps feasibility.
- Hard travel limits remove candidates.
- Soft travel limits become human-readable warnings.
- Unknown MCP tools remain available.
- Mutating MCP tools route to previews.
- Failed connectors degrade gracefully.

### iOS and Web

- Named ETAs appear without origin coordinates.
- Map pins render candidate venues only.
- Current-location override is opt-in and plan-scoped.
- Generic MCP cards render lists, fields, links, errors, and attribution.
- Approval sheets distinguish holds, purchases, and irreversible actions.
- Global unavailable and degraded states are clear.

## Architecture Challenge

The design assumes a thin gateway can preserve MCP flexibility while still making unknown tools safe
and legible. That may fail for connectors whose outputs are inconsistent or whose transaction APIs
do not support reliable price previews, idempotency, or cancellation.

The alternative is a stricter typed capability platform that only exposes deeply normalized
connectors. We are deliberately not choosing it because flexibility is a product priority. The
mitigation is progressive enhancement: unknown tools remain generic, transactions are previewed and
audited, and low-quality connectors surface degraded status rather than pretending to be native.

## Official References

- Google Maps SDK for iOS:
  <https://developers.google.com/maps/documentation/ios-sdk/overview>
- Places autocomplete for iOS:
  <https://developers.google.com/maps/documentation/places/ios-sdk/place-autocomplete>
- Places details for iOS:
  <https://developers.google.com/maps/documentation/places/ios-sdk/place-details>
- Routes API route matrix:
  <https://developers.google.com/maps/documentation/routes/compute_route_matrix>
- Routes API waypoint guidance:
  <https://developers.google.com/maps/documentation/routes/specify_location>
- Google Calendar free/busy:
  <https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query>
- WeatherKit:
  <https://developer.apple.com/weatherkit/>
- Google MCP catalog:
  <https://github.com/google/mcp>
- MCP reference servers and production-readiness warning:
  <https://github.com/modelcontextprotocol/servers>
