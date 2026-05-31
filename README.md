＜✦＞ PLOT

> **Plot** is a group-chat planning agent. Friends talk in a thread; an AI member named **Plot**
> stays quiet during banter, detects when the group is actually trying to make a plan, gathers
> availability, proposes a decision card, collects votes (including from people who don't have the
> app, over SMS/web), and — when a soft deadline passes — locks a concrete plan: **time + place +
> RSVP + a bring-list**. Every autonomous thing Plot does is written to a reversible audit log.

This repo is a **runnable end-to-end vertical slice** of the entire stack wired together. One real
flow runs through every layer; everything outside that flow is scaffolded behind clean interfaces
(clearly marked, never faked).

---

## ⚠️ Assumptions & inputs

`spec.md` (the PRD) was delivered as a **0-byte file**, so the data model (§18), plan state machine
(§10), agent behaviour (§9), and trust model (§13) are **reconstructed from the goal brief** (see
`docs/PRD.md`). The **HTML mockup was provided** (`plot-mockup (1).html`) and the UI is **mirrored
from it**.

- **Visual language** (mirrored from `plot-mockup (1).html`): dark / premium / minimal-futuristic.
  Canvas `#0C0E12`, surface `#15181F`, **hairline borders** `rgba(255,255,255,.07)`, **mint** accent
  `#5FE6C1`, **amber** "needs you" `#F2B25C`, mint-tinted "me" bubble `#15271F`. Type: **Sora**
  (display), **Onest** (body), **IBM Plex Mono** (metadata). Brand mark is the **✦** sigil in an
  accent-dim rounded chip. Tokens live in one place per platform
  (`ios/Plot/DesignSystem/Theme.swift`, `web/styles/theme.css`). The iOS app reproduces the mockup's
  Chats / Plans / Discover / You tabs, the group thread, the decision card (↑BOOST/↓VETO + crown +
  no-booking/booking tags), the amber soft-deadline banner, the locked "confirm" card + bring-list,
  **Plot's Desk** (reversible activity log + over-cap approval), and the **non-user SMS preview**.
- **The Crew** (per the mockup): **Alex** (you / organizer), **Max**, **Sam**, **Priya** on the app,
  and **Jordan** as the non-user reached over SMS.
- **OTP dev code** is `000000` (any phone). **Sign in with Apple** dev mock returns a canned
  identity. No Stytch keys required.
- **Agent intelligence degrades deterministically**: with `ANTHROPIC_API_KEY` set, the LangGraph
  graph uses Claude tool-use; with no key it falls back to a keyword/heuristic classifier so the
  whole slice still runs offline with zero keys. Both paths traverse the *same* graph nodes.
- **Soft deadline** for the demo is compressed to **45 seconds** (`PLOT_SOFT_DEADLINE_SECONDS`) so
  the auto-lock is observable in a sitting; production default would be hours.
- The non-user "SMS" is **logged to stdout + persisted** and the signed link is served by `/web`.

---

## Architecture

```
┌──────────────┐      REST (OpenAPI)      ┌───────────────────────────────────────────┐
│   iOS app    │ ───────────────────────▶ │              api  (NestJS)                 │
│  SwiftUI     │ ◀─────────────────────── │  modular monolith + Socket.IO realtime     │
│  MVVM+Obs.   │   WebSocket (live state) │                                            │
└──────────────┘                          │  chat · plan · money · notifications ·     │
                                          │  non-user-gateway · identity · integrations│
┌──────────────┐   signed link / vote     │                                            │
│ non-user     │ ───────────────────────▶ │  ── Prisma ──▶ Postgres (+pgvector)        │
│ (web browser)│   /web (Next.js)         │  ── ioredis ─▶ Redis                        │
└──────────────┘                          └───────┬───────────────────────┬────────────┘
                                                  │ HTTP                   │ Inngest events
                                                  ▼                        ▼
                                   ┌────────────────────────┐   ┌────────────────────────┐
                                   │ agent (Python FastAPI) │   │ Inngest (durable wf)    │
                                   │ LangGraph + Claude      │◀──│ timers, vote-waits,     │
                                   │ typed tool registry     │   │ soft-deadline auto-lock │
                                   │ Postgres checkpointer    │   │ CALLS the agent         │
                                   └────────────────────────┘   └────────────────────────┘
```

**Why these boundaries.** The agent is a *separate* service because its lifecycle (LLM calls, graph
checkpoints) and scaling profile differ from the request/socket API. The durable workflow (Inngest)
*owns time* — soft deadlines, vote-waits, contingencies — and calls the agent at decision points;
the agent itself is stateless between graph runs (state lives in the Postgres checkpointer + the
Prisma source of truth). The API is the single writer to Postgres and the single broadcaster over
Socket.IO, so every layer sees one consistent plan state.

The flow the agent walks (PRD §9):

```
detect-intent ──▶ stay-quiet                      (banter → say nothing)
       │
       ├────────▶ ask                             (ambiguous → one in-thread question)
       │
       └────────▶ gather-availability ─▶ research ─▶ propose-decision ─▶ await-votes ─▶ act-or-ask
                  (EventKit busy/free)  (Places)   (decision card)    (Inngest timer)   │
                                                                                        ├─ act  → lock plan + audit
                                                                                        └─ ask  → human-approval
                                                                                                  (over spend-cap /
                                                                                                   irreversible)
```

---

## Repo tree

```
plot/
├── README.md                     ← you are here
├── docker-compose.yml            ← Postgres + Redis + Inngest dev server
├── .env.example                  ← EVERY env var, documented
├── package.json                  ← pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                    ← Turborepo pipeline
├── docs/
│   ├── PRD.md                    ← reconstructed PRD (§9 §10 §13 §18)
│   └── CLICKPATH.md              ← exact steps to watch the slice
├── db/                           ← Prisma: the source of truth (all of §18)
│   ├── package.json
│   ├── prisma/schema.prisma
│   ├── prisma/seed.ts            ← "The Crew" — 5 members incl. 1 non-user
│   └── src/client.ts
├── openapi/
│   ├── openapi.yaml              ← REST contract (hand-authored, source of truth)
│   ├── generate-swift.sh         ← swift-openapi-generator invocation
│   └── README.md
├── api/                          ← NestJS modular monolith
│   ├── package.json · tsconfig.json · nest-cli.json
│   └── src/
│       ├── main.ts · app.module.ts
│       ├── common/               ← prisma, redis, audit, auth guard, ws gateway
│       ├── identity/             ← AuthProvider iface + Stytch + dev mock; /me (availability, devices, permissions, cap)
│       ├── groups/               ← create group, invite members/non-users, my-groups list
│       ├── chat/                 ← threads, messages, agent trigger
│       ├── plan/                 ← §10 state machine, votes, lock
│       ├── money/                ← Stripe Connect iface + mock (split/escrow)
│       ├── notifications/        ← APNs iface + dev log impl
│       ├── non-user-gateway/     ← signed links, non-user vote reconcile
│       ├── integrations/         ← Calendar + Places connectors (mock + iface)
│       └── inngest/              ← durable functions (soft-deadline auto-lock)
├── agent/                        ← Python FastAPI + LangGraph
│   ├── pyproject.toml · README.md
│   └── plot_agent/
│       ├── main.py               ← FastAPI app
│       ├── graph.py              ← explicit LangGraph state machine
│       ├── nodes.py              ← detect-intent, gather, research, propose, act-or-ask
│       ├── tools.py              ← typed tool registry (permission+cap BEFORE, audit AFTER)
│       ├── llm.py                ← Claude tool-use OR deterministic fallback
│       └── api_client.py         ← talks back to NestJS
├── web/                          ← Next.js — signed non-user vote/RSVP pages
│   ├── package.json · next.config.mjs
│   ├── app/v/[token]/page.tsx    ← the vote page a non-user opens
│   └── styles/theme.css
├── ios/                          ← Xcode/SPM SwiftUI app
│   ├── Package.swift
│   ├── README.md
│   └── Plot/
│       ├── PlotApp.swift
│       ├── DesignSystem/Theme.swift
│       ├── Networking/{APIClient,SocketClient}.swift
│       ├── Calendar/EventKitService.swift
│       ├── Auth/SignInWithApple.swift
│       ├── Models/*.swift
│       ├── ViewModels/*.swift
│       └── Views/*.swift
└── scripts/
    ├── dev.sh                    ← one command: infra up, migrate, seed, all services
    └── demo.sh                   ← drives the slice end-to-end from the CLI (no iOS needed)
```

---

## Local run sequence (zero real keys)

```bash
# 0. prerequisites: Docker, Node 22 + corepack (pnpm), Python 3.11+. On macOS for iOS: Xcode 15+.
corepack enable                       # provides pnpm
cp .env.example .env                  # all mocks on by default

# 1. one command brings up infra, migrates, seeds, and starts api + agent + web + inngest
./scripts/dev.sh
#    (or step by step:)
#    docker compose up -d             # Postgres, Redis, Inngest
#    pnpm install
#    pnpm --filter @plot/db prisma:migrate && pnpm --filter @plot/db seed
#    pnpm --filter @plot/api dev   &   # :3000 REST + :3000 ws
#    pnpm --filter @plot/web dev   &   # :3001 non-user pages
#    (cd agent && uv run uvicorn plot_agent.main:app --port 8000)

# 2. watch the slice with NO iOS at all (pure backend proof):
./scripts/demo.sh
#    → prints the chat transcript, Plot staying quiet, the decision card,
#      the non-user "SMS" link, the auto-lock after the soft deadline, and the audit log + an undo.

# 3. or run the iOS app on a simulator (verified on Xcode 26 / iPhone 17):
cd ios && xcodegen generate && open Plot.xcodeproj   # pick an iOS 17 sim → Run
#   (headless build+install+launch + the dev auto-drive hooks: see ios/README.md)
```

See **`docs/CLICKPATH.md`** for the exact tap-by-tap path through the app.

---

## REAL vs MOCKED

| Capability | In this slice | Behind the interface (`//TODO: REAL CREDENTIAL`) |
|---|---|---|
| **Create group + invite members** (incl. non-user by phone) | **REAL** (`groups` module; in-app from iOS) | — |
| **Live Chats list / multi-group** | **REAL** (`GET /me/groups`; iOS is fully data-driven) | — |
| Group chat + messages | **REAL** (Postgres, Socket.IO) | — |
| Plan state machine §10 | **REAL** (enforced in `plan.service.ts` + tests) | — |
| Agent graph §9 (intent → … → act/ask) | **REAL** LangGraph; Claude if key, else deterministic | swap `llm.py` impl |
| Decision card w/ mixed options | **REAL** | — |
| Voting (app users) | **REAL** | — |
| **Non-user vote via SMS/web** | **REAL via mock** (SMS logged, link served by `/web`) | `TwilioComms` → real Twilio |
| Soft-deadline auto-lock timer | **REAL** (Inngest local) | — |
| Audit log + Undo (compensating action) | **REAL** | — |
| Spend-cap gate + over-cap human approval | **REAL** | — |
| Calendar busy/free | **REAL** — iOS EventKit reads device free/busy → `POST /me/availability`; server `MockCalendarProvider` serves it | Google → `CalendarProvider` |
| Device push registration | **REAL** (`POST /me/devices`; iOS registers on launch) | real APNs token → `ApnsProvider` |
| Trust-model settings (permissions + spend cap) | **REAL** (`/me/permissions`, `/me/spend-cap`; persisted, You tab) | — |
| Places options | **REAL mock** `MockPlacesProvider` (canned) | Google/Foursquare → `PlacesProvider` |
| Auth (phone-OTP + Apple) | **REAL dev mock** (OTP `000000`) | `StytchAuthProvider` |
| Payments — **even split + escrow hold/capture/refund** | **REAL** (`MockPaymentProvider`; split card on the locked plan, pay-share → capture, non-user pays via SMS link; `AGENT_CREATED_SPLIT` audit + `REFUND_SPLIT` undo) | `StripeConnectProvider` |
| Push notifications | **REAL dev mock** (logs token+payload) | `ApnsProvider` |
| Media storage | **REAL local-disk** impl | `S3MediaStore` (R2/S3) |
| **Booking** | **REAL** — `MockBookingProvider` books (confirmation + spend) or **degrades to tap-to-call/deep-link**; `LOCKED→BOOKED`; `AGENT_BOOKED` audit + `CANCEL_BOOKING` undo; "Book it" on the card | `BookingProvider` (OpenTable/Resy/DICE) |
| **Self-enforcing contingencies** | **REAL** — Plot sets them at propose; shown on Plot's Desk; switch-to-backup is **enactable** (`RESTORE_LOCKED` undo) | autonomous enactment on real signals |
| Surprise mode / private budget cap | **REAL** (never broadcast; enforced server-side) | — |

---

## Real features (the app is usable without the seed/demo)

The iOS app is **fully data-driven** — nothing is hardcoded. A brand-new user (any phone, OTP
`000000`) can:
- **Create a group** and **invite members** — real users by phone, or **non-users by phone** who
  then vote/RSVP/pay over SMS (`POST /groups`, `POST /groups/:id/members`).
- See their **live Chats list** across all groups with last message + plan state (`GET /me/groups`).
- Open any group thread; Plot reads the **device's real EventKit busy/free** (synced via
  `POST /me/availability` — busy/free only, no titles), proposes, and runs the §10 flow.
- Manage the **trust model in the You tab** — per-action permissions and the spend cap persist
  server-side (`/me/permissions`, `/me/spend-cap`).
- **Book** a locked plan (organizer tap or, with `BOOK_VENUE` + within cap, Plot) → `BOOKED` +
  confirmation, or a **tap-to-call** fallback; **undo** cancels it (`POST /plans/:id/book`).
- **Settle up** — Plot sets up an even split (needs `SPEND_MONEY`, else it asks in-thread); members
  **pay their share** (`/splits/:id/pay`) and the escrow captures once everyone's in; **undo** refunds.
- See & **enact contingencies** on Plot's Desk (`POST /plans/:id/contingencies/:idx/enact`).
- Register for push (`POST /me/devices`).

`db/prisma/seed.ts` now only provides a convenient starting account ("The Crew"); the app no longer
depends on it. (These `groups`/`me` endpoints extend the hand-authored `openapi/openapi.yaml`, which
still covers the original slice.) `scripts/demo.ts` remains as an end-to-end test, not a runtime dep.

---

## NEXT TO BUILD (prioritized, mapped to plug-in points)

1. **Real Twilio comms** → implement `TwilioComms` in `api/src/notifications/comms.twilio.ts`
   (interface `Comms` already consumed by `non-user-gateway`). Flip `COMMS_PROVIDER=twilio`.
2. **Real calendar busy/free** → iOS already reads EventKit; server `GoogleCalendarProvider`
   implements `CalendarProvider` (`api/src/integrations/calendar/`). Flip `CALENDAR_PROVIDER`.
3. **Booking provider** → implement `BookingProvider` (`api/src/plan/booking/`) — the plan already
   locks without it; booking is an *additive* step that attaches a confirmation to a locked plan.
4. **Stripe Connect** → implement `StripeConnectProvider` (`money` module); mock already models
   split + escrow hold/capture/refund so the money state machine is exercised today.
5. **Real Stytch auth** → implement `StytchAuthProvider` (`identity`); the `AuthProvider` interface
   and JWT session issuance are unchanged.
6. **Claude in prod** → set `ANTHROPIC_API_KEY`; `agent/plot_agent/llm.py` already routes to
   tool-use. Add streaming + cost accounting to the `await-votes` node.
7. **pgvector recall** → `Embedding` table + index exist; wire a `recall` tool into the registry so
   the agent remembers group preferences across plans.

---

## Tests (the slice)

```bash
pnpm --filter @plot/api test     # plan state-machine transitions; audit + undo; non-user reconcile
cd agent && uv run pytest        # agent act / stay-quiet / ask routing
```

See `api/test/*.spec.ts` and `agent/tests/*.py`.
