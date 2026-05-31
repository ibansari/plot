# PLOT — PRD (reconstructed)

> The shipped `spec.md` was empty. This is the working PRD reconstructed from the build brief,
> covering the four sections the brief cites. It is the contract the code is written against.

## §9 — Agent behaviour

Plot is a member of the thread that **defaults to silence**. On every new human message the agent
graph runs `detect-intent`, which returns exactly one of:

- **STAY_QUIET** — banter, logistics already settled, or no planning signal. Plot says nothing and
  writes **no** audit row (silence is not an action).
- **ASK** — a planning intent is present but under-specified (missing date window, missing people,
  ambiguous activity). Plot posts **one** concise clarifying question, then waits.
- **ACT** — clear planning intent. Plot proceeds through the planning sub-graph:
  `gather-availability → research → propose-decision → await-votes → act-or-ask`.

Rules:
- Plot proposes; people decide. Plot never overrides an explicit human choice.
- Every tool the agent calls checks **permission + spend-cap BEFORE** executing and writes an
  **audit row AFTER**. Irreversible or over-cap actions route to a **human-approval** node that
  posts an in-thread approval request and pauses.
- Plot resolves a plan **with or without booking**. Resolution = a locked **time + place + RSVP**
  (+ an auto-generated bring-list). Booking is an optional, additive enrichment.

## §10 — Plan state machine

```
DRAFT ──propose──▶ PROPOSED ──open_voting──▶ VOTING ──(soft deadline | quorum)──▶ LOCKED
  │                   │                        │                                    │
  │                   └──────cancel────────────┴──────────────cancel────────────────┤
  │                                                                                  ▼
  └──cancel──▶ CANCELLED                                              LOCKED ──(book)──▶ BOOKED
                                                                      LOCKED ──unlock──▶ VOTING   (undo)
```

States: `DRAFT, PROPOSED, VOTING, LOCKED, BOOKED, CANCELLED`.
Transitions (the only legal ones; enforced in `plan.service.ts` and tested):

| from | event | to | guard |
|---|---|---|---|
| DRAFT | `propose` | PROPOSED | has ≥1 option |
| PROPOSED | `openVoting` | VOTING | has ≥2 options |
| VOTING | `lock` | LOCKED | soft-deadline fired **or** quorum reached; picks leader option |
| LOCKED | `book` | BOOKED | booking provider succeeds (else stays LOCKED, degraded) |
| LOCKED | `unlock` | VOTING | compensating action for an auto-lock (undo) |
| any non-terminal | `cancel` | CANCELLED | actor is organizer or Plot-with-approval |

A **lock** writes `lockedOptionId`, `lockedTime`, `lockedPlace`, freezes RSVPs, and generates the
bring-list. `LOCKED` is a valid terminal resolution; `BOOKED` is not required.

## §13 — Trust model

- **Least authority**: each integration connector declares the scopes it needs; the agent can only
  call a tool if the group/user granted that scope (`Permission` rows). Default deny.
- **Spend cap**: per-plan `spendCapCents`. A tool that spends money checks the running total + the
  requested amount against the cap *before* acting. Over cap → `human-approval`.
- **Calendars store busy/free ONLY** — never event titles/details. Enforced at the connector
  boundary (`CalendarBusyFree` type has no title field) and on iOS (EventKit read maps to busy
  intervals before leaving the device).
- **Reversibility**: every autonomous action writes an immutable `AuditLog` row carrying a typed
  `undo` descriptor; an operator or the organizer can replay the compensating action.
- **Privacy of surprise/budget**: `Plan.surpriseMode` and a member's private `budgetCapCents` are
  never included in any broadcast/notification payload; server strips them per-recipient.

## §18 — Data model

Implemented in full in `db/prisma/schema.prisma`. Core entities:

`User` · `Contact` (non-user) · `Group` · `GroupMember` · `Thread` · `Message` · `Plan` ·
`PlanOption` · `Vote` · `Rsvp` · `BringItem` · `AvailabilityWindow` · `Permission` · `AuditLog` ·
`MoneyAccount` · `Split` · `SplitShare` · `NonUserToken` · `Device` · `Embedding` ·
`IntegrationConnection`. Enums: `PlanState`, `OptionKind`, `VoteValue`, `RsvpStatus`, `MemberRole`,
`AuditAction`, `SplitState`, `MessageKind`.
