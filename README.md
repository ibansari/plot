<div align="center">

# ✦ Plot

**The group chat that makes plans actually happen.**

Plot is an AI planning agent that lives inside a group thread. It stays quiet during banter,
notices when the group is genuinely trying to make a plan, gathers availability, proposes a
decision card, collects votes — including from people who don't have the app — and locks a
concrete plan: **time + place + RSVP + bring-list**. Every autonomous action is written to a
reversible audit log.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-agent-1C3C3C)](https://langchain-ai.github.io/langgraph/)
[![SwiftUI](https://img.shields.io/badge/SwiftUI-iOS%2017+-F05138?logo=swift&logoColor=white)](https://developer.apple.com/xcode/swiftui/)
[![Postgres](https://img.shields.io/badge/Postgres-16%20+%20pgvector-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

---

## Table of contents

- [What Plot does](#what-plot-does)
- [How the agent thinks](#how-the-agent-thinks)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Capability status](#capability-status)
- [Repository layout](#repository-layout)
- [Testing](#testing)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What Plot does

| | |
|---|---|
| **Reads the room** | A cheap classification gate keeps Plot silent through banter. It speaks only when the thread is actually trying to plan something. |
| **Gathers real availability** | iOS reads the device's EventKit busy/free (free/busy only — never event titles) and syncs it to the server. |
| **Researches real options** | Venue search over a seeded local catalog, or live OpenStreetMap Nominatim (no key) with the catalog as a graceful fallback. |
| **Proposes, doesn't dictate** | A decision card with mixed options, boost/veto voting, and a visible soft deadline. |
| **Includes non-users** | People without the app get a signed link over email/SMS and can vote and RSVP from a browser. |
| **Locks the plan** | When the soft deadline passes, a durable workflow auto-locks the winning option — time, place, RSVP, bring-list. |
| **Books and settles up** | Optional booking (with tap-to-call fallback) and an even split with escrow hold/capture/refund. |
| **Stays accountable** | Every autonomous action is auditable and reversible from *Plot's Desk*, and gated by per-action permissions plus a spend cap. |

### Trust model

Plot never acts outside the boundaries the group sets. Each capability maps to a permission scope,
and anything over the spend cap or irreversible escalates to a human approval instead of executing.
Mutating tools are physically withheld on uninvited (proactive) turns, so Plot can observe without
being able to act.

---

## How the agent thinks

The message path is an **agentic tool-use loop**, not a fixed pipeline. Claude sees the live thread,
the group's remembered constraints, and a real toolset, then decides which tools to call and in what
order.

```
message:   dispatch → detect-intent → remember ─┬─ stay-quiet          (banter → silence, cheap gate)
                                                └─ agent loop ─▶ END   (Claude picks tools freely)

deadline:  dispatch → act-or-ask ─┬─ act → settle-up                   (auto-lock, then offer a split)
                                  └─ human-approval                    (over cap / irreversible)
```

**Tools available to the loop:** `gather_availability`, `research_places`, `get_plan`,
`propose_plan`, `post_message` (the only speech channel), and `finish_turn` (explicit stop — the
default is silence). MCP servers can be connected at runtime to add more; their tools are registered
through the same trust gate, and any tool marked `mutating` becomes an approval-gated action.

---

## Architecture

```
┌──────────────┐      REST (OpenAPI)      ┌────────────────────────────────────────────┐
│   iOS app    │ ───────────────────────▶ │              api  (NestJS)                 │
│  SwiftUI     │ ◀─────────────────────── │  modular monolith + Socket.IO realtime     │
│  MVVM + Obs. │   WebSocket (live state) │                                            │
└──────────────┘                          │  chat · plan · money · notifications ·     │
                                          │  non-user-gateway · identity · recall ·    │
┌──────────────┐   signed link / vote     │  integrations (places · maps · weather ·   │
│  non-user    │ ───────────────────────▶ │  calendar · MCP connectors)                │
│ (web browser)│   /web (Next.js)         │                                            │
└──────────────┘                          │  ── Prisma ──▶ Postgres (+ pgvector)       │
                                          │  ── ioredis ─▶ Redis                       │
                                          └───────┬────────────────────────┬───────────┘
                                                  │ HTTP                   │ Inngest events
                                                  ▼                        ▼
                                   ┌─────────────────────────┐  ┌─────────────────────────┐
                                   │ agent (Python FastAPI)  │  │ Inngest (durable wf)    │
                                   │ LangGraph + Claude      │◀─│ timers, vote-waits,     │
                                   │ typed tool registry     │  │ soft-deadline auto-lock │
                                   │ Postgres checkpointer   │  │ calls the agent         │
                                   └─────────────────────────┘  └─────────────────────────┘
```

**Why these boundaries.**

- **The agent is a separate service.** Its lifecycle (LLM calls, graph checkpoints) and scaling
  profile differ sharply from a request/socket API.
- **The durable workflow owns time.** Soft deadlines, vote-waits, and contingencies live in Inngest,
  which calls the agent at decision points. The agent stays stateless between graph runs — state
  lives in the Postgres checkpointer and the Prisma source of truth.
- **The API is the single writer.** One writer to Postgres and one broadcaster over Socket.IO means
  every client sees exactly one consistent plan state.

### Tech stack

| Layer | Stack |
|---|---|
| iOS client | SwiftUI (iOS 17+), MVVM + Observation, EventKit, generated OpenAPI client |
| Web client | Next.js — signed vote/RSVP pages for non-users |
| API | NestJS modular monolith, Socket.IO, Prisma, Inngest |
| Agent | Python 3.11+, FastAPI, LangGraph, Anthropic SDK (tool use + structured outputs), MCP |
| Data | Postgres 16 + pgvector, Redis |
| Contract | Hand-authored `openapi/openapi.yaml`, Swift client generated from it |

---

## Quick start

Everything below runs with **zero paid credentials**.

### Prerequisites

- Docker (Postgres, Redis, Inngest, stripe-mock, Mailpit)
- Node 20+ (22 recommended) with corepack enabled, for pnpm
- Python 3.11+
- macOS with Xcode 15+ *(only if you want to run the iOS app)*

### Run the stack

```bash
corepack enable            # provides pnpm
cp .env.example .env       # mocks on by default; no keys required

./scripts/dev.sh           # infra up → install → migrate → seed → api + agent + web
```

<details>
<summary>Step by step, instead of <code>dev.sh</code></summary>

```bash
docker compose up -d                                   # Postgres, Redis, Inngest, stripe-mock, Mailpit
pnpm install
pnpm --filter @plot/db build
pnpm --filter @plot/db prisma:migrate
pnpm --filter @plot/db seed
pnpm --filter @plot/api dev &                          # :3000 — REST + WebSocket
pnpm --filter @plot/web dev &                          # :3001 — non-user pages
(cd agent && uv run uvicorn plot_agent.main:app --port 8000)
```

</details>

| Service | URL |
|---|---|
| API (REST + WebSocket) | http://localhost:3000 |
| Web (non-user pages) | http://localhost:3001 |
| Agent | http://localhost:8000 |
| Inngest dev UI | http://localhost:8288 |
| Mailpit inbox | http://localhost:8025 |

### See it end to end, without iOS

```bash
./scripts/demo.sh
```

The script drives the whole flow from the CLI and prints the chat transcript, Plot staying quiet
through banter, the decision card, the non-user invite link, the auto-lock after the soft deadline,
and the audit log plus an undo.

### Run the iOS app

```bash
cd ios
brew install xcodegen       # one-time
xcodegen generate           # → Plot.xcodeproj
open Plot.xcodeproj         # pick an iOS 17 simulator → Run
```

See [`ios/README.md`](ios/README.md) for the headless build/install/launch path, and
[`docs/CLICKPATH.md`](docs/CLICKPATH.md) for a tap-by-tap walkthrough.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The defaults run the full stack
against local servers with no accounts. The provider switches are the interesting part — each one
selects between a real local implementation and a hosted service:

| Variable | Default | Options |
|---|---|---|
| `AUTH_PROVIDER` | `otp` | `otp` (random code, Redis-hashed, 5-min TTL, single-use, rate-limited) · `stytch` · `mock` (fixed `000000`) |
| `COMMS_PROVIDER` | `smtp` | `smtp` (real SMTP → Mailpit) · `twilio` (cellular SMS) · `mock` |
| `PAYMENT_PROVIDER` | `stripe` | `stripe` (real Stripe SDK → `stripe-mock`) · `mock` |
| `PLACES_PROVIDER` | `db` | `osm` (live Nominatim, degrades to catalog — the default when unset) · `db` (seeded catalog) · `google` · `mock` |
| `CALENDAR_PROVIDER` | `mock` | `mock` · `google` |
| `BOOKING_PROVIDER` | `mock` | `mock` (books, or degrades to tap-to-call) · `stub` · partner integrations |
| `PUSH_PROVIDER` | `mock` | `mock` (logs token + payload) · `apns` |
| `MEDIA_STORE` | `disk` | `disk` · `s3` (R2/S3) |
| `PLOT_MCP_SERVERS` | *empty* | JSON array of MCP servers whose tools join the agent loop behind the trust gate |

A few tuning knobs worth knowing:

- `PLOT_SOFT_DEADLINE_SECONDS` defaults to **45** so auto-lock is observable in one sitting; a
  production default would be hours.
- `ANTHROPIC_API_KEY` enables the Claude brain. Without a key — or on an API error — the agent
  returns conservative defaults and stays quiet rather than acting on heuristics.
- `PLOT_DEFAULT_SPEND_CAP_CENTS` sets the default autonomous spend ceiling.

---

## Capability status

### Working with no paid credentials

| Capability | Implementation |
|---|---|
| Groups, invites (users and non-users), multi-group chat list | Postgres + Socket.IO |
| Group chat and realtime updates | `message.created` / `plan.updated` / `audit.created` over Socket.IO |
| Plan state machine | Enforced server-side, covered by tests |
| Agent loop (intent → tools → propose → act/ask) | LangGraph + Claude tool use *(requires `ANTHROPIC_API_KEY`)* |
| Decision cards, boost/veto voting | End to end across iOS and web |
| Non-user vote / RSVP | Signed links served by the Next.js app |
| Soft-deadline auto-lock | Inngest durable workflow |
| Audit log + undo (compensating actions) | Every autonomous action is reversible |
| Permissions + spend-cap gate, over-cap approval | Persisted per user, enforced before every tool call |
| Phone-OTP auth | Random code, Redis-hashed, TTL, single-use, rate-limited |
| Payments — even split, escrow hold/capture/refund | Official Stripe Node SDK against Stripe's `stripe-mock` |
| Comms delivery (OTP + invites) | Real SMTP to Mailpit |
| Places search | Seeded Postgres catalog by default; `PLACES_PROVIDER=osm` fetches live OpenStreetMap Nominatim results and falls back to the catalog |
| Preference recall | pgvector cosine over a local feature-hashing embedding |
| Calendar busy/free | iOS EventKit → `POST /me/availability` |
| Booking | Books with confirmation, or degrades to tap-to-call; `CANCEL_BOOKING` undo |
| Contingencies | Set at propose time, shown on Plot's Desk, switch-to-backup is enactable |
| Media storage | Local disk |

### Requires an account or business approval

Each of these is a real interface with a working local stand-in — going live is credentials plus one
environment flip.

| Capability | Why it's gated | Flip to real |
|---|---|---|
| Cellular SMS | Twilio number (paid) | `TWILIO_*` + `COMMS_PROVIDER=twilio` |
| Live Stripe | A Stripe account | `STRIPE_SECRET_KEY` + clear `STRIPE_API_BASE` |
| APNs background push | Apple Developer key | `APNS_*` + `PUSH_PROVIDER=apns` |
| Hosted / Apple login | Stytch or Apple Developer | `STYTCH_*` + `AUTH_PROVIDER=stytch` |
| Google Places | Places billing | `PLACES_PROVIDER=google` + key |
| Booking partners | OpenTable / Resy / DICE B2B access | Implement `BookingProvider` + `BOOKING_PROVIDER=…` |
| Claude brain | `ANTHROPIC_API_KEY` | Set the key |

---

## Repository layout

```
plot/
├── api/                    NestJS modular monolith
│   └── src/
│       ├── chat/           threads, messages, agent trigger
│       ├── plan/           plan state machine, votes, lock, booking, contingencies
│       ├── groups/         group creation, member + non-user invites
│       ├── identity/       auth providers, /me (availability, devices, permissions, spend cap)
│       ├── money/          split + escrow (Stripe SDK / mock)
│       ├── non-user-gateway/  signed links, non-user vote reconciliation
│       ├── integrations/   places, maps, weather, calendar, MCP connectors
│       ├── recall/         pgvector preference memory
│       ├── notifications/  push + comms providers
│       └── inngest/        durable functions (soft-deadline auto-lock)
├── agent/                  Python FastAPI + LangGraph
│   └── plot_agent/
│       ├── graph.py        explicit state machine
│       ├── loop.py         Claude tool-use agent loop
│       ├── tools.py        typed tool registry (permission + cap BEFORE, audit AFTER)
│       ├── brain.py        structured-output reasoning calls
│       └── constraints.py  constraint memory + expiry
├── ios/                    SwiftUI app (xcodegen project spec + SPM)
├── web/                    Next.js — signed non-user vote/RSVP pages
├── db/                     Prisma schema, migrations, seed
├── openapi/                hand-authored REST contract + Swift client generation
├── docs/                   PRD, click-path walkthrough, design specs
├── scripts/                dev.sh (run everything) · demo.sh (drive the flow)
└── docker-compose.yml      Postgres + Redis + Inngest + stripe-mock + Mailpit
```

---

## Testing

```bash
pnpm --filter @plot/api test     # plan state machine, audit + undo, money split,
                                 # non-user reconcile, MCP gateway, booking, recall
cd agent && uv run pytest        # routing, agent loop, brain, constraints, settle-up
```

Suites live in [`api/test/`](api/test) and [`agent/tests/`](agent/tests).

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: data model, plan state machine, agent behaviour, trust model |
| [`docs/CLICKPATH.md`](docs/CLICKPATH.md) | Exact tap-by-tap path through the app |
| [`docs/superpowers/specs/`](docs/superpowers/specs) | Design specs for MCP-first integrations and in-app connections |
| [`openapi/openapi.yaml`](openapi/openapi.yaml) | REST contract (source of truth for the Swift client) |
| [`agent/README.md`](agent/README.md) | Agent graph, tool registry, and trust gate in depth |
| [`ios/README.md`](ios/README.md) | iOS build, simulator, and headless run instructions |

---

## Roadmap

- **Cellular SMS** — implement `TwilioComms` behind the existing `Comms` interface.
- **Google Calendar busy/free** — server-side `CalendarProvider` alongside the iOS EventKit path.
- **Real booking partners** — implement `BookingProvider`; booking is additive to a locked plan.
- **Live Stripe Connect** — the split/escrow state machine is already exercised against `stripe-mock`.
- **Hosted auth** — `StytchAuthProvider` behind the unchanged `AuthProvider` interface.
- **Agent observability** — streaming responses and per-turn cost accounting around the Claude loop.
- **Sharper recall** — swap the local feature-hashing embedding for a hosted embedding model.

---

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Run the test suites above and make sure they pass.
2. Keep provider integrations behind their existing interfaces — new capabilities should be a new
   implementation plus an environment switch, not a change to call sites.
3. Any new autonomous action needs a permission scope, a spend-cap check, and a compensating undo.
4. Update [`openapi/openapi.yaml`](openapi/openapi.yaml) when you change the REST surface.

---

## License

No license file is currently included, so all rights are reserved by default. If you'd like to use
this code, please open an issue to discuss it.
