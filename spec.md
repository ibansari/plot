# Plot — Product Requirements Document

**Product:** Plot — the group chat that makes plans actually happen
**Document type:** Full product spec (PRD) for engineering + coding-agent handoff
**Version:** 0.1 (draft) · **Status:** For build · **Last updated:** 31 May 2026
**Companion artifact:** `plot-mockup.html` (interactive, iPhone-17 dimensions). Section references to the mockup are noted as → *Mockup: [surface]*.

---

## 0. How to read this document

This PRD is written to be implementable. It moves from *why* (sections 1–6) to *what* (7–16) to *how* (17–22). Engineers building the system should anchor on three things: the **plan object** (§10), the **agent behaviour spec** (§9), and the **trust/authority model** (§13) — everything else hangs off those. The coding agent should treat the **mockup as the source of truth for layout and visual language**, and this document as the source of truth for behaviour, data, and edge cases.

Where a feature has testable behaviour, an **Acceptance** line is included. These are deliberately terse — expand into test cases during build.

---

## 1. Product overview

**One sentence.** A group chat with an AI member, *Plot*, that quietly turns the endless "so what are we doing?" into plans that actually happen — finding when everyone's free, researching the options, running the vote, locking it in (booking it when there's something to book), splitting the cost, and keeping the night running — without anyone leaving the conversation.

**The problem.** Friend groups don't lack ideas or desire; they lack *resolution*. The 80-message thread that dies in indecision is the enemy. The pain compounds across three predictable failure points: deciding (nobody commits), money (one person becomes the group's debt collector), and the day-of (plans wobble and nobody re-coordinates).

**The insight.** Close the resolution gap *inside* the conversation rather than exporting people to Doodle, Splitwise, a booking site, and a maps app. Keep the messy human conversation — the part that's actually the point — front and centre, and let an autonomous agent do real work at its edges with permissioned, reversible authority.

**Who it's for (initial wedge).** Established friend groups (4–8 people) who already have a group chat and do low-stakes, high-frequency hangouts. The product is **general-purpose group planning** — it organizes anything a group does together. The *go-to-market wedge* is the most frequent, lowest-stakes context (a casual hangout or night out — dinner, drinks, a games night, a film, a spontaneous catch-up) because frequency builds the habit; bigger occasions like trips are the payoff, not a separate product.

**What Plot plans (occasion-agnostic).** The planning engine doesn't care what the occasion is. It plans dinners and drinks, but equally a games night at someone's place, a hike, a run, a gig or club night, a cinema trip, a picnic, a birthday, a weekend away, or a last-minute "who's around?". *Resolution* means a **locked time, place, and who's coming** — plus, *only when the occasion needs it*, a booking, a ticket purchase, a split, and a calendar hold. A large share of real plans need **no external booking at all** ("everyone's at mine at 8, bring snacks"); for those, resolution is simply the agreed time/place/RSVP (and an optional split). Booking is one *capability* Plot reaches for, never the point.

---

## 2. Goals and non-goals

**Goals (what success requires).**
Plot must be as good at "drinks tonight" as "a week in Lisbon," must reach the one friend who refuses to install anything, and must earn enough trust to act with money and on people's behalf. The product wins when a group's default planning behaviour moves *into* Plot and stays there because resolution is faster and fairer than the group chat alone.

**Non-goals (explicitly out of scope, at least early).**
Plot is not a social network, a discovery feed for strangers, a dating product, or a general-purpose assistant. It does not try to replace the group's primary chat app for *all* messaging — it earns the chat by being where plans live, not by demanding migration. It does not hold user funds directly (escrow runs through a regulated marketplace provider). It does not become the place you hang out; it's the helpful presence at the edges.

---

## 3. Success metrics

**North Star:** *Resolved plans per active group per month* — a plan that travels idea → decision → confirmed booking/RSVP. This single metric captures the core value (resolution) and is hard to game without delivering it.

| Tier | Metric | Why it matters |
|---|---|---|
| North Star | Resolved plans / active group / month | Core value delivered |
| Input | Median time-to-resolution (first idea → locked decision) | The "kills indecision" promise |
| Input | % of planning threads that reach a decision | Resolution rate vs. the dead-thread baseline |
| Input | Vote participation rate (per decision) | Are quiet voices included |
| Input | Non-user participation rate (SMS/web votes & pays) | The adoption mechanic working |
| Input | Resolution conversion (locked decision → confirmed plan: booking *or* RSVP) | The "ends in a real, on-the-calendar plan" promise |
| Input | Settle-up completion rate & time | Money pain solved |
| Retention | Group M3 / M6 retention; weekly active groups | Habit formed |
| Health | Organizer-load distribution (Gini across members) | Burnout reduced, not automated away |
| Trust | Undo rate, over-cap approval rate, "Plot got it wrong" rate | Authority is calibrated correctly |

**Guardrail metrics (must not regress):** notification opt-out rate, group-leave rate after a Plot action, payment dispute rate, and a qualitative "felt like Plot overstepped" signal.

---

## 4. Personas and core jobs-to-be-done

**The Organizer (primary).** Does all the planning and is quietly burning out. JTBD: *"Make it happen without it always being on me."* Plot redistributes the work and chases the money so they stop being the debt collector.

**The Busy One.** Wants in but is hard to pin down. JTBD: *"Tell me when I actually need to do something, and make that one tap."* Served by availability intelligence and priority-tiered notifications.

**The Broke One.** Budget-sensitive, embarrassed to keep saying so. JTBD: *"Keep it in my range without me having to be the cheap friend out loud."* Served by private per-person budget caps and silent filtering.

**The Non-user.** Won't install the app. JTBD: *"Let me vote, RSVP, and pay from my texts."* Served by the non-user bridge (§11) — this persona is make-or-break for adoption.

**The Connector.** Brings people in, forms sub-crews. JTBD: *"Easily pull the right people into the right plan."* Served by smart invites and sub-crews.

**Group archetypes** (shape settings and defaults): the close friend group (social), the recurring ritual (run club, monthly dinner), the trip crew (high-stakes, time-boxed), and — later, B2B — the standing org (club, team, community).

**Representative user stories.**
*As the Organizer,* when I say "let's do something Saturday" — whether that's dinner, a games night, or a gig — I want Plot to find when everyone's free, propose vetted options, run the vote, and lock it in (booking or buying tickets only if the plan needs it) — so it resolves while I get on with my evening.
*As the Broke One,* I want my budget cap respected silently — so suggestions fit my wallet without me announcing it.
*As the Non-user,* I want to vote and pay from an SMS link — so I'm fully in the plan without installing anything.
*As any member,* I want to see exactly what Plot did on its own and undo any of it — so I trust it with real authority.

---

## 5. Product principles (binding design constraints)

These are the guardrails that separate a beloved app from one that quietly kills friendships by automating them away. Treat them as acceptance criteria for *every* feature.

1. **Chat first, always.** The conversation is the product. Plot never becomes the place you hang out.
2. **The agent earns its turns.** Plot stays silent during banter and speaks only when it adds resolution.
3. **Discussion stays attached to decisions.** Debate threads *off* a choice (inline) so it never drowns in the scroll.
4. **Authority is real, bounded, and reversible.** Plot can book, spend, and text people — only within group-set limits, and every action has an undo and an audit trail.
5. **Humans stay in the loop where it matters.** Spending over a cap, inviting someone, anything irreversible → Plot pauses and asks.
6. **Frequency over grandeur.** Nail "drinks tonight" before "a week in Lisbon."
7. **Meet people where they already are.** The 5th friend who won't install anything must still be able to vote, RSVP, and pay.

---

## 6. Scope summary (the feature universe)

Eight areas. (A) is the core loop; the rest make a group *love* it. Detailed specs follow in §8.

- **A. Planning engine** — availability → research → decision → soft deadline → (booking/tickets, *only if the occasion needs it*) → constraint memory. Works for any occasion, including plans with nothing to book.
- **B. Money** — auto-split, pre-collection/escrow, group tab, budget transparency, fair-share options.
- **C. Day-of** — live ETAs, meeting points, convoy mode, proactive reroutes, live tab.
- **D. Memory & ritual** — shared albums, "year together" recap, "on this day," recurring rituals, rate-the-night.
- **E. Discovery & spontaneity** — proactive nudges, context triggers, "who's around now," tailored ideas.
- **F. Fairness & group health** — rotate the chooser, organizer-burnout detection, quiet-voice inclusion, smart invites.
- **G. Travel** — trip modes, group flight/stay/activity booking, packing/itinerary docs, per-traveller reconciliation, surprise mode.
- **H. Agent autonomy layer ("Plot's Desk")** — background work, living plan object with contingencies, 1:1 negotiation across surfaces, full reversible activity log.

---

## 7. Information architecture and navigation

Five primary surfaces, structured like a messaging app so it feels instantly familiar. → *Mockup: all tabs.*

1. **Chats (home).** A list of group chats — one chat per friend group. Rows surface unread state, upcoming-plan chips, and Plot's "needs-you" flags. → *Mockup: Tab 1.*
2. **The group chat (centrepiece).** Banter + inline decision cards + threaded debate + votes, with Plot folded in quietly. From inside a chat, the header reaches that group's **Plan details / Plot's Desk**, **Members & permissions**, **Shared album**, and **Money/ledger**. → *Mockup: Tab 2 + header overlays.*
3. **Plans.** A unified cross-group calendar — upcoming and past — with RSVP states and live day-of info. → *Mockup: Tab 3.*
4. **Discover.** Tailored ideas, local events/tickets radar, seasonal nudges, and "who's free right now." → *Mockup: Tab 4.*
5. **You.** Taste profile, connected calendars/payments, notification + autonomy preferences, privacy controls, and your groups. → *Mockup: Tab 5.*

**Cross-cutting flows:** onboarding & group creation, progressive permission-granting, the non-user web/SMS experience, and per-plan **Plot's Desk**.

**Navigation rules.** Deep links resolve to a specific group + surface (e.g., a notification about a closing vote opens the decision card in-thread). The chat is reachable in ≤1 tap from any plan reference. Plot's Desk is a *peek* off the chat (the green plan bar), never a primary tab — the autonomy layer is demoted by design.

---

## 8. Feature specifications

### A. Planning engine (the core loop)

The non-negotiable spine: from "let's do something" to a booked, paid-for, on-the-calendar plan.

**A1. Availability intelligence.** Reads connected calendars (busy/free only) and computes *actual* mutual free windows, factoring time zones and travel time between a member's prior commitment and the proposed location. No Doodle.
*Acceptance:* given N members with connected calendars, Plot returns ranked candidate windows with the count of available members per window; members without calendars are handled gracefully (asked, or treated as flexible).

**A2. In-chat research.** When the group needs to pick a place/activity, Plot researches *in the thread* and posts a structured, votable comparison: rating, price band, distance, vibe, and a **"why it fits *this* group"** line (e.g., "cheap-ish, veggie options for Sam, walkable"). It also flags poor fits (over budget, violates a constraint). Research spans **places, activities, and events** — a restaurant, a bowling alley, an escape room, a gig, a film, a trail — and is **skipped entirely** when the group already knows what they're doing ("games night at mine"), in which case Plot goes straight to time + RSVP. → *Mockup: research/decision card.*
*Acceptance:* each option carries source-backed metadata + a fit rationale that references at least one known group constraint; flagged options state the reason.

**A3. Decision tools beyond polls.** Ranked-choice, **boost-one / veto-one**, head-to-head brackets, and swipe-to-match ("Tinder for plans"). Plot picks the method to fit the situation (few options → boost/veto; many → swipe/bracket) and can be overridden.
*Acceptance:* every decision object computes a current leader and surfaces vote counts; ties trigger a tiebreak prompt rather than silent resolution.

**A4. Threaded debate.** Every decision object carries its own discussion thread so arguing has a home and never drowns the main scroll. → *Mockup: "3 replies on Bartola."*

**A5. Soft deadlines.** Plot sets a gentle "I'll lock this by 6pm unless someone shouts," killing eternal limbo. Deadlines are visible, snooze-able by any member once, and auto-resolve to the leader. → *Mockup: deadline strip.*
*Acceptance:* at deadline, Plot locks the leader, posts the outcome, and proceeds to booking only if booking authority is granted (§13); otherwise it hands off.

**A6. Booking & action.** Reserves the table, buys tickets, holds the Airbnb, books the lanes — with one group confirmation — and reschedules automatically when plans shift. Subject to the authority model and graceful degradation (§13, §12). Many plans need **no external booking** — for those, "action" is simply locking the time/place, sending RSVPs, writing the calendar hold, and (optionally) splitting costs. → *Mockup: booking confirmation card.*

**A7. Constraint memory.** Plot *knows* Sam's gluten-free, Max hates sushi, Jordan's broke this month — and filters silently so nobody re-litigates. Constraints are per-member, scoped per-group, editable, and expire when stated as temporary ("broke *this month*"). → *Mockup: Members sheet shows Sam's dietary flag.*

---

### B. Money (the Splitwise the group never has to think about)

The single most-painful part of group plans.

**B1. Auto bill-splitting** with a running who-owes-what ledger across all hangouts. Fair-share options: **even**, **by-item**, or **"treat"** tracking ("Sam got drinks"). → *Mockup: Money sheet.*

**B2. Pre-collection / escrow** for deposits and tickets — Plot chases the money so the organizer stops being the debt collector. **Built on a regulated marketplace provider (Stripe Connect); Plot never holds funds directly.** This triggers real compliance weight (money transmission, KYC, and EU/UK Strong Customer Authentication) — see §13 and §17. → *Mockup: deposit pre-collection card.*

**B3. Group tab** for the night, settled automatically afterward over the rails people already use.

**B4. Upfront budget transparency** ("this weekend ≈ $220pp") and a **per-person, private budget cap** that filters suggestions without broadcasting anyone's limit.

*Acceptance:* the ledger always nets to a settle-up instruction set; collected funds are traceable to a provider transaction; a member's private cap is never visible to others.

---

### C. Day-of (live coordination)

The plan exists; now make the night actually run. (Primarily V2.)

**C1. Live ETAs and auto running-late pings** ("Jordan's 10 min out") from opted-in location sharing.
**C2. Meeting points & "we moved to the patio"** updates pushed to everyone, with precise meet-points (e.g., What3Words).
**C3. Convoy mode** for multiple cars (from the road-trip work) — everyone on a map, regroup points, fuel-aware.
**C4. Proactive reroutes & saves** — storm incoming, table running behind, place packed → Plot adjusts and tells the group.
**C5. Live tab & last-call nudges** during the event.

*Acceptance:* location features are strictly opt-in per event and auto-expire when the event ends; no background location beyond the event window.

---

### D. Memory & ritual (the emotional glue + retention engine)

**D1. Shared album per hangout** — photos auto-collected from everyone (opt-in), no group-text dump. → *Mockup: Album sheet.*
**D2. "Your year together"** — a Wrapped-style recap of the group's adventures; wildly shareable, emotionally sticky. → *Mockup: Album sheet header.*
**D3. "On this day"** memories resurface and prompt the next plan.
**D4. Recurring rituals** — the monthly dinner, Sunday run, weekly games night — kept alive automatically ("Your monthly dinner — want me to sort the next one?"). → *Mockup: "Sunday Run Club," recurring chip.*
**D5. Rate-the-night** — one-tap reaction that sharpens future suggestions and feeds the taste model.

---

### E. Discovery & spontaneity (the frequency multiplier)

**E1. Proactive nudges** — "It's been three weeks, everyone's free Thursday, want me to plan something?" Re-engagement as a core interaction, not spam. → *Mockup: Discover nudge.*
**E2. Context triggers** — long weekend, a member's birthday, a saved band coming to town, great weather, or a wishlisted restaurant suddenly has openings.
**E3. "Who's around right now?"** — broadcast availability for spontaneous last-minute drinks. → *Mockup: Discover "I'm free."*
**E4. Tailored ideas** — "3 things you haven't done together," tuned to taste and season.

*Acceptance:* proactive messages are rate-limited per group (configurable; default ≤1 unprompted nudge/week) and respect quiet hours; a single dismissal suppresses repeats of that nudge.

---

### F. Fairness & group health (the quiet differentiator)

**F1. Rotate the chooser** ("Max picked last time — Jordan's turn") to defuse same-person-decides friction. → *Mockup: implied in fairness logic.*
**F2. Organizer-burnout detection** — notices when one person does all the planning and gently redistributes.
**F3. Make quiet voices count** — ensures the friend who never votes still gets asked (a direct, low-pressure prompt).
**F4. Smart invite suggestions** — "this feels like a Sam-and-Jordan thing," plus easy sub-crews.

---

### G. Travel & big trips (premium, high-value vertical) — V2

**G1. Trip modes:** day trip, weekend away, full holiday, the road trip (itinerary, convoy, scenic routing). → *Mockup: "Lisbon 2026" chat + plan card.*
**G2. Flights, accommodation, and activities** researched, voted, and booked as a group.
**G3. Group packing lists, itineraries, and shared docs.**
**G4. Per-traveller reconciliation** — who paid for what across the whole trip, settled at the end.
**G5. Surprise mode** — plan a birthday trip in a hidden sub-thread the guest of honour can't see.

*Acceptance:* surprise sub-threads are invisible to the named member across *all* surfaces (chat, plans, notifications, calendar writes) until reveal.

---

### H. Agent autonomy layer ("Plot's Desk")

The operating surface beneath the chat — demoted to a peek, never the main view. → *Mockup: Plot's Desk overlay.*

**H1. Background work** — holds tables, watches for cancellations, re-checks calendars, all between conversations.
**H2. A living plan object** with state and **self-enforcing contingencies** ("if Jordan's late, hold the table; if it's lost, rebook the backup; if someone drops, re-split"). → *Mockup: Contingencies block.*
**H3. 1:1 negotiation across surfaces** — gathers each person's constraints privately (in-app, SMS, or agent-to-agent) to keep the group thread clean.
**H4. Full activity log** of everything Plot did on its own — each item reversible. → *Mockup: Activity log with Undo.*

---

## 9. The Plot agent — behaviour specification

Plot is a *member*, not a command line. Its behaviour is governed by the principles in §5 and the rules below.

**When Plot speaks.** Plot stays silent during banter. It surfaces only to add **resolution**: breaking a stalemate, summarizing a thread that's grown too long, answering "where though?" with research, posting a decision when the group is circling, setting/closing a soft deadline, confirming an action, or asking for an approval it's required to ask for. A turn that doesn't move the plan forward is a turn Plot doesn't take.
*Acceptance:* in a banter-only window (no planning intent detected), Plot posts nothing. Introduce a planning signal and Plot responds within one turn.

**Tone & voice.** Warm, concise, never performative. Per-group **personality tuning** ranges from nearly-invisible to chatty (§16). Plot never nags; deadlines and chases are gentle and capped.

**What Plot reasons about (responsibilities of the orchestration layer).**
Detect planning intent in the chat; identify the occasion type; resolve references ("the usual place," "same as last time") against group memory; compute availability; decide *whether* and *which* research is needed; choose the decision method; set soft deadlines; decide when an action is in-policy vs. requires approval; select tools and sequence them; and write to the plan object. Crucially, it must decide **act vs. stay quiet vs. ask** on every cycle.

**Hard behavioural rules.**
Plot never takes irreversible or out-of-policy actions without explicit human approval. Plot always shows its work (every autonomous action lands in the activity log). Plot degrades gracefully (§12) rather than failing silently. Plot reconciles non-user input (SMS/web) back into the thread in real time. Plot respects per-member privacy (never reveals a private budget cap or a surprise-mode plan).

**Inputs available to the agent.** Group chat messages and threads; the plan object and its history; per-group taste/constraint memory; availability cache (busy/free); granted integrations and their scopes; the group's authority settings and spend cap; notification/quiet-hours prefs.

---

## 10. The plan object (the spine) — state model

The plan is a **long-lived, stateful entity**, independent of any single message. It is the unit the background runner monitors and the activity log attaches to. Implement it as a durable workflow (see §17 — durable execution is strongly recommended so contingencies survive restarts and run between conversations).

**Plan states and transitions.**

| State | Meaning | Primary exit transitions |
|---|---|---|
| `idea` | Planning intent detected; nothing decided | → `gathering` (Plot starts work) or → `abandoned` (thread dies / dismissed) |
| `gathering` | Computing availability, researching options | → `deciding` (options posted) |
| `deciding` | Decision object open; voting; soft deadline running | → `locked` (deadline/consensus) or back to `gathering` (reopened) |
| `locked` | Choice made; awaiting booking | → `booking` (authority granted) or → `handoff` (no authority / no integration) |
| `booking` | Hold/confirm in progress; deposits collecting | → `confirmed` or → `failed` (→ contingency) |
| `confirmed` | Booked + on calendars; deposits tracked | → `day_of` (event window opens) or → `rescheduling` (plans shift) |
| `day_of` | Live coordination active | → `completed` |
| `rescheduling` | Re-running booking after a change | → `confirmed` or → `handoff` |
| `handoff` | Plot couldn't fully act; gave the group a tap-to-act fallback | → `confirmed` (group completes) or → `abandoned` |
| `completed` | Event happened | → memory pipeline (album, rate-the-night, recap) |
| `abandoned` | Plan died | terminal |

**Contingencies** are declarative rules attached to a plan (`if <trigger> then <action>`), evaluated by the background runner. Triggers include: member running late (from live ETA), booking lost/cancelled (provider webhook), member drops (RSVP change), weather threshold crossed, venue running behind. Actions include: hold/extend, rebook backup option, re-split ledger, notify group, pause for approval. Each contingency action is itself logged and reversible.

**Backup option.** A locked decision should retain the runner-up as the designated backup so `rescheduling` and the "booking lost" contingency have a target without re-deciding.

---

## 11. The non-user bridge (adoption-critical)

Getting a whole group to switch chat apps is otherwise fatal, so **non-users must fully participate without installing.** → *Mockup: Non-user SMS preview.*

**Capabilities for non-users.** Vote on decisions, RSVP, and pay their share — all from an SMS reply or a signed web link. Receive plan updates and day-of pings via SMS.

**Flow (vote → RSVP → pay over SMS).**
1. A decision opens; Plot texts the non-user a one-line prompt + a signed short link (e.g., `plot.to/v/<token>`), or accepts a structured SMS reply (e.g., the option number).
2. The non-user replies (SMS) or taps the link (mobile web). Their vote is attributed and reconciled into the group thread in real time, with channel = `sms`/`web`.
3. On lock, Plot texts the outcome and an RSVP prompt (reply `YES`/`NO`).
4. If a deposit is due, Plot texts a signed pay link; payment is collected via the provider and reflected in the ledger.

**Identity.** A non-user is a `GuestContact` (phone + name + channel) tied to a `Membership` with status `non_user`. If they later install, the guest record merges into a full `User` (preserving votes, RSVPs, and ledger history).

**Constraints & honesty.** SMS is the primary channel for non-users. **RCS** should be supported where available (richer cards, read receipts) with **SMS fallback**. Signed links must be short-lived, scoped to a single decision/payment, and revocable.

*Acceptance:* a non-user with only a phone number can complete vote + RSVP + pay end-to-end without an app, and their actions appear in the group thread within seconds.

---

## 12. Integrations

This is a substantially expanded set beyond the original brief, organized by category, prioritized by phase, and annotated for UK/EU relevance (the launch region). **Important:** several consumer platforms do *not* offer the open APIs a naïve plan assumes — those constraints and the realistic paths are called out in §12.2. Treat all third-party API access, partner approval, and commercial terms as **to-be-validated per provider during build**; the architecture must assume any given integration can be unavailable and degrade gracefully (§ design principle: tap-to-call / deep-link fallback). Note that the **planning engine is occasion-agnostic and integration-optional**: availability, decisions, soft deadlines, RSVPs, calendar holds, and splitting all work with *no* third-party booking provider. Booking, ticketing, and reservation connectors add the ability to *finish* the subset of plans that need an external reservation — they are additive, not foundational.

### 12.1 Integration catalogue (prioritized)

| Category | Providers (UK/EU-relevant in **bold**) | Job in Plot | Phase |
|---|---|---|---|
| **Calendars** | Google Calendar, Apple Calendar, **Microsoft Outlook**, ICS feed import, Calendly, Notion Calendar, Fantastical | Busy/free availability; write tentative holds + confirmed events | **MVP** (Google/Apple/Outlook) |
| **Messaging / reach** | **SMS gateway (Twilio/Sinch/MessageBird)**, **RCS**, WhatsApp Cloud API, Telegram, Discord, Slack, Signal, Instagram DM, Messenger, Microsoft Teams | Non-user bridge; bring Plot into existing chats | **MVP** (SMS) → V1 (WhatsApp/Telegram/Discord/Slack) |
| **Reservations (restaurants etc.)** | **TheFork**, **OpenTable**, **Resy**, Tock, SevenRooms, Yelp Reservations, Google Reserve, Quandoo | Hold/confirm tables (one *optional, additive* booking type) | **MVP+** (first booking connector; not a launch dependency — see §12.2) |
| **Food delivery** | **Deliveroo**, **Just Eat**, Uber Eats, DoorDash | Order in for stay-in nights | V2 |
| **Tickets & events** | **DICE**, **Skiddle**, **See Tickets**, Ticketmaster, Eventbrite, SeatGeek, AXS, Fever, TodayTix, Resident Advisor | Buy/group-buy tickets | V1 → V2 |
| **Artist/event radar** | Songkick, Bandsintown | "A band you all like is coming to town" trigger | V1 |
| **Cinema** | **Odeon/Vue/Cineworld**, Fandango/Atom, Letterboxd (taste) | Book seats; decide what to watch | V2 |
| **Flights** | **Skyscanner**, Google Flights, Kayak, Hopper, Duffel (aggregated booking) | Research/vote/book group flights | V2 |
| **Stays** | Airbnb, Booking.com, Vrbo, Hotels.com, Plum Guide, Hostelworld | Hold/book group accommodation | V2 |
| **Ground travel** | **Trainline / National Rail**, **FlixBus**, Omio, Sixt/Enterprise/Turo (car), ferries | Rail/coach/car for trips & day trips | V2 |
| **Activities/experiences** | GetYourGuide, Viator, Klook, Fever, **ClassPass**, **Strava** (run/cycle groups), GolfNow, Hipcamp/Pitchup (camping), AllTrails (hikes) | Book/decide non-food activities; fuel recurring rituals | V1 (Strava for Run Club) → V2 |
| **Maps & routing** | Google Maps, Apple Maps, **Citymapper**, Waze, **What3Words** (precise meet-points), Rome2Rio | Directions, travel-time, convoy, meet-points | MVP (maps/travel-time) → V2 (convoy) |
| **Mobility / ride** | Uber, **Bolt**, Lyft, Lime/Tier (scooters), Transit | Get to the plan; day-of | V1 |
| **Parking** | **JustPark**, SpotHero, ParkWhiz | Day-of logistics | V2 |
| **Payments — split/settle** | **Apple Pay**, **Google Pay**, PayPal, Venmo, Cash App, Zelle, **Revolut**, **Monzo** (Shared Tabs), Wise (multi-currency), Splitwise (import/export) | Settle-up over existing rails | **MVP** (Apple/Google Pay + one P2P) |
| **Payments — escrow/infra** | **Stripe Connect** (escrow/marketplace), Plaid, **TrueLayer/Tink** (UK/EU open banking) | Pre-collection/deposits without holding funds; bank connectivity | V1 |
| **KYC / fraud** | Persona/Onfido (KYC for escrow), Stripe Radar/Sift | Compliance + payment safety | V1 |
| **Music / vibe** | Spotify (incl. collaborative Jam), Apple Music, Sonos (control the room), Shazam | Group playlist; set the mood | V1 |
| **Photos / memory** | Apple Photos / iCloud Shared Albums, Google Photos, Instagram (tagged), Canva (recap export) | Auto-collect album; "year together" | V1 |
| **Weather / environment** | Apple WeatherKit, **Met Office**, OpenWeather, AccuWeather; UV, AQI, tide & sunset | Day-of saves; golden-hour/beach triggers | MVP (weather) → V2 (environment) |
| **Docs / productivity (B2B-leaning)** | Google Docs/Sheets, Notion, Airtable, Trello, Microsoft 365, Zapier/Make | Trip docs, packing lists; org/club use | V2 / B2B |
| **Identity / contacts** | Sign in with Apple, Google, phone OTP, passkeys, Contacts API, Truecaller | Auth; find friends | MVP |
| **Comms infra** | Twilio (SMS/voice), SendGrid/Postmark (email), APNs/FCM (push) | Notifications & non-user bridge | MVP |
| **Booking confirmation parsing** | Gmail/Outlook read scope | Read confirmations Plot didn't make, to keep the plan object accurate | V2 |

### 12.2 Hard integration realities (do not skip)

- **iMessage.** There is **no third-party iMessage bot API.** "Add Plot to your iMessage thread" is not literally achievable; the realistic iMessage path is the **SMS/RCS bridge** (Plot participates as a phone number), or Apple Messages for Business (support-oriented, not group-chat-native). Plan and copy should reflect this — the non-user bridge *is* the iMessage story in practice.
- **WhatsApp.** Use the **WhatsApp Cloud API** with its constraints: business-initiated messages require approved **templates**, and free-form replies are limited to a **24-hour customer-service window**. Design nudges around these limits.
- **Booking/reservation APIs.** Reservation platforms (e.g., OpenTable, Resy) generally require **partner/affiliate approval** and don't expose open public booking endpoints to arbitrary developers. Because the engine is integration-optional, **MVP does not depend on any of them** — most plans resolve with a locked time/place + RSVP + calendar hold and need no reservation. Where a plan *does* need one, Plot either (a) uses a secured partner connector, or (b) uses **graceful degradation**: it drafts the booking and hands off a tap-to-call / deep link. If prioritizing a first reservation connector for UK/EU, **TheFork** is a sensible pick.
- **Telegram, Discord, Slack** have first-class bot APIs and are the *easiest* real chat surfaces — good early targets for the "bring Plot into an existing chat" story.
- **Payments.** Holding deposits = **money transmission**. Use **Stripe Connect** (or equivalent) so Plot never touches funds directly; expect **KYC** and, in the UK/EU, **PSD2 Strong Customer Authentication**. Settle-up "over existing rails" (Venmo/PayPal/Apple Pay) may be deep-link/initiate rather than fully programmatic depending on the rail.

---

## 13. Permissions, authority, and trust model

This is the **license to operate** — not optional polish. → *Mockup: You tab (toggles + spend cap) and Plot's Desk (activity log, undo, over-cap approval).*

**Per-action authority.** Granular controls govern what Plot may do unsupervised. A **spend cap** gates spending; anything above it pauses for approval. Irreversible actions always require per-action approval. Reversible actions get an **undo**, and *everything* lands in a complete **audit log**.

**Authority matrix (defaults).**

| Action | Default | Reversible | Requires approval | Audited |
|---|---|---|---|---|
| Research & post options | Allowed | n/a | No | Yes |
| Set/close a soft deadline | Allowed | Yes (reopen) | No | Yes |
| Lock the leading decision | Allowed | Yes (reopen) | No | Yes |
| Hold a table (no charge) | Allowed | Yes (release) | No | Yes |
| Confirm a booking | Allowed if "book" granted | Yes (cancel, provider-permitting) | No (within cap) | Yes |
| Add to members' calendars | Per-member toggle | Yes (remove) | No | Yes |
| Charge **under** spend cap | Allowed if granted | Refundable | No | Yes |
| Charge **over** spend cap | Blocked | — | **Yes** | Yes |
| Collect a deposit (escrow) | Allowed if granted | Refundable | No (within cap) | Yes |
| Text a non-member | Per-toggle | n/a | No | Yes |
| Auto-rebook (backup option) | Off by default | Yes | No if on; else Yes | Yes |
| Invite a new member | — | n/a | **Yes** | Yes |
| Cancel a confirmed booking | Allowed (own bookings) | Often irreversible → treat as approval-required if non-refundable | Conditional | Yes |

**Roles.** Per-group roles (admin vs. member) govern *who can change Plot's permissions and the spend cap*, add/remove members, and archive the group. Default: any member can plan; only admins change authority settings.

*Acceptance:* no autonomous action executes without a matching granted permission; every executed action produces an audit entry with `actor=plot`, timestamp, payload, `within_policy`, and `reversible`; an over-cap action never executes and instead creates an approval request visible in-thread and on Plot's Desk.

---

## 14. Notifications

**Priority tiers.** **P0 — needs you now** (a vote closing, a payment due, a day-of "you're late"), **P1 — actionable** (a new plan proposed, you've been invited), **P2 — FYI** (booked, settled up), **P3 — digest** (weekly recap, proactive nudges).

**Channels.** Push with **SMS fallback**; SMS is the **primary** channel for non-users; email for receipts/itineraries/digests. RCS where available.

**Batching & quiet.** P2/P3 batch into a configurable **daily/weekly digest** so Plot is present without being noisy. Per-person **quiet hours** are respected for everything except P0 (and P0 is reserved for genuinely time-critical, user-relevant events). Proactive nudges are rate-limited per group.

*Acceptance:* during quiet hours, only P0 may interrupt; a single dismissal of a P3 nudge suppresses its repeats; digests never duplicate an item already delivered individually.

---

## 15. Privacy and data

**Data minimization & consent.** Explicit, scoped consent for Plot reading the chat and calendars. **Calendars are busy/free only by default** — Plot sees *that* you're busy, not *what* you're doing. → *Mockup: You tab "Busy/free only."*

**Personal vs. group separation.** Clear boundary between personal data and group data; **per-person privacy** (your budget cap, your private constraints, and surprise-mode plans are not broadcast).

**Security & compliance.** Encryption in transit and at rest; regional compliance (**GDPR/CCPA**, UK-GDPR); a real **one-tap data deletion** that cascades correctly (including guest records and ledger obligations handled appropriately). Payment-token and OAuth-token storage in a dedicated secrets vault.

**Progressive permissions.** Ask for calendar/payment/location access only when a feature first needs it, never up front. → *Onboarding flow.*

---

## 16. Identity, accounts, settings & group management

**Identity.** Lightweight, **phone-number-based** accounts (OTP) with Sign in with Apple/Google and passkeys; **guest mode** for non-users. One identity, many groups; clean group switching. → *Mockup: You tab.*

**Settings & group management.** Roles/admins (who can plan, who can change Plot's permissions); add/remove members; archive/leave groups; connected accounts; notification + autonomy prefs; and **agent personality/voice tuning** (chatty ↔ nearly-invisible per group). → *Mockup: You tab "Plot's voice."*

**Trust, safety & moderation.** Leave a group, block, report; spam and abuse handling; content safety on anything Plot generates or surfaces; financial safety via the caps/approvals above; agent guardrails (no irreversible/out-of-policy actions; always shows its work).

**Accessibility & localization (first-class, not afterthoughts).** Screen-reader support, dynamic type/large text, sufficient contrast, and full keyboard/switch control; multi-currency and multi-time-zone handling; locale-aware provider selection (e.g., TheFork/Deliveroo/Trainline/Met Office in the UK); RTL readiness.

---

## 17. Technical architecture

A light sketch expanded into buildable components. The non-obvious, load-bearing choice is **durable execution for the plan object** so contingencies and background monitoring survive process restarts and run reliably between conversations.

**Components.**
- **Client apps** — iOS, Android, and a responsive web app (the web app also serves the non-user link experience).
- **API gateway / BFF** — auth, rate limiting, per-client shaping; realtime via WebSockets for chat + live plan state.
- **Chat service** — messages, threads (attached to plans/decisions/options), presence, realtime fan-out.
- **Agent orchestration service** — the model(s) that read the chat, reason, plan, select/sequence tools, and decide **act vs. stay quiet vs. ask**. Houses the "earns its turns" policy and prompt/reasoning logic; stateless per request, reading state from the plan + memory stores.
- **Plan service** — owns the plan object and its **state machine** (§10); runs as **durable workflows** (e.g., Temporal or equivalent) so each plan is a long-lived process with timers (soft deadlines), waits (votes), and the **contingency engine**.
- **Tool / integration layer** — typed connectors for calendars, payments, bookings, maps, ticketing, SMS, etc. Each connector enforces **permission checks**, writes to the **audit log**, applies **rate limits**, and implements **graceful degradation** (return a tap-to-act fallback instead of failing silently).
- **Money service** — split engine, running ledger, escrow via **Stripe Connect**, KYC orchestration, settle-up initiation; isolated for compliance and PCI scope minimization.
- **Notification service** — tiering, batching, quiet-hours, push (APNs/FCM) + SMS (Twilio) + email.
- **Non-user gateway** — inbound/outbound SMS parsing, signed/short-lived web links, guest↔user merge.
- **Memory / taste store** — per-group preferences, constraints, and history; a **vector store** for semantic recall ("the usual place") plus structured constraint records.
- **Privacy-preserving calendar handler** — stores **busy/free blocks only**, never event contents.
- **Identity service** — phone OTP, OAuth, passkeys, contacts.

**Data stores.** Primary OLTP (PostgreSQL) for core entities; an event log/stream (e.g., Kafka) for the activity log and triggers; Redis for caching/availability; object storage for photos; a vector DB for memory; a secrets/token vault for OAuth + payment tokens.

**Cross-cutting.** Observability (tracing every autonomous action end-to-end), feature flags, fraud (Stripe Radar/Sift), and a privacy-respecting analytics pipeline (e.g., self-hostable) consistent with §15.

**Event flow (illustrative).** A new chat message → chat service emits an event → orchestration evaluates planning intent → if acting, it reads/writes the plan workflow and calls tools via the integration layer → tool results + any autonomous action are written to the audit log and reflected in the plan state → notification service tiers and delivers updates → non-user gateway mirrors relevant prompts over SMS.

---

## 18. Core data model

Condensed. Names are indicative; relationships matter more than exact column types.

| Entity | Key fields | Notes |
|---|---|---|
| `User` | id, phone, name, avatar, locale, timezone, auth_methods | One identity, many groups |
| `GuestContact` | id, phone, name, channel | Non-user; merges into `User` on install |
| `Group` | id, name, type{social,recurring,trip,org}, created_by, settings, plot_personality | One per friend group |
| `Membership` | id, group_id, principal{user_id\|guest_id}, role{admin,member}, status{active,non_user,left}, budget_cap_private, constraints[] | Per-member constraints scoped here |
| `Plan` | id, group_id, title, occasion_type, **state**, window/time, location, budget_estimate, backup_option_id, created_by | The spine (§10); a durable workflow |
| `Contingency` | id, plan_id, trigger, action, status | Evaluated by background runner |
| `DecisionObject` | id, plan_id, type{poll,ranked,boost_veto,bracket,swipe}, prompt, deadline, status, thread_id, leader_option_id | Carries its own thread |
| `Option` | id, decision_id, source{research,user}, title, metadata{rating,price,distance,vibe,fit_reason}, booking_ref | Fit rationale required |
| `Vote` | id, decision_id, option_id, voter{user\|guest}, type{boost,veto,rank}, weight, channel{app,sms,web} | Channel tracked for non-users |
| `Thread` / `Message` | thread: attached_to{plan\|decision\|option}; message: sender{user\|guest\|plot}, body, kind{banter,system,plot} | Debate attached to decisions |
| `Booking` | id, plan_id, provider, external_ref, status{held,confirmed,cancelled,failed}, party_size, time, cost, deep_link | Webhooks drive contingencies |
| `Hold` | id, plan_id, provider, expires_at | Pre-confirmation |
| `LedgerEntry` | id, group_id, plan_id, payer, amount, split_method{even,by_item,treat}, shares[], status, rail, external_txn_ref | Always nets to settle-up |
| `EscrowCollection` | id, plan_id, target_amount, per_person, collected[], provider=stripe_connect, status | Never holds funds directly |
| `ActivityLogEntry` | id, plan_id, actor=plot, action, payload, reversible, reversed, within_policy, created_at | Powers undo + audit |
| `Integration` | id, scope{user,group}, provider, type, scopes_granted, status | OAuth tokens in vault, referenced |
| `CalendarLink` | user_id, provider, mode=busy_free, token_ref | Busy/free only |
| `NotificationPref` | user_id, tier_settings, quiet_hours, channels | §14 |
| `Memory` | group_id, constraint_records[], history_embeddings | Compounding moat |

---

## 19. Key flows (sequences)

**Plan lifecycle (happy path).**
1. A member signals intent ("let's do something Saturday" — dinner, a film, a games night, whatever). Plot detects it → plan enters `gathering`.
2. Plot computes mutual availability (busy/free) and posts candidate windows.
3. Plot researches options and posts a decision card (`deciding`), sets a soft deadline.
4. Members (and non-users via SMS) vote; debate threads off the card.
5. At deadline (or clear consensus) Plot locks the leader (`locked`), retains runner-up as backup.
6. With "book" authority and within cap, Plot books and adds to calendars (`confirmed`); otherwise it hands off a tap-to-act link (`handoff`).
7. Plot opens a deposit collection if configured; chases non-payers gently.
8. Event window opens (`day_of`) → live coordination → `completed` → album, rate-the-night, recap.

**Booking with contingency.**
Plot places a `Hold` → on group confirm, `Booking` → registers contingencies (late → extend hold; lost → rebook backup; drop → re-split) → provider webhook of a cancellation fires the "lost" contingency → Plot rebooks the backup, re-splits any deposit, and notifies the group; each step is logged and reversible.

**Over-cap approval.**
Plot computes a proposed action that exceeds the spend cap → it does **not** execute → it creates an approval request in-thread and on Plot's Desk → on approval it proceeds and logs; on decline it stops and records the decision. → *Mockup: "Add bowling → over your $40 cap."*

**Non-user vote → pay.** See §11.

**Undo.** Any reversible activity-log entry exposes an undo that calls the connector's compensating action (release hold, cancel booking where permitted, remove calendar event, refund deposit), updates plan state, and notifies affected members. → *Mockup: Activity log "Undo."*

---

## 20. Monetization

Designed in early, because ads and a twice-a-year subscription won't carry it. Ads are avoided in-product — they'd corrode the trust an acting, spending agent depends on.

- **Free core** — chat, planning, voting, basic splitting. Drives the network.
- **Premium tier** — advanced autonomy, the travel/holiday planner, unlimited research/bookings, and group perks (priority reservations, group recaps). Sold per-group or per-power-user.
- **Booking commissions** — on the *bookable subset* of plans (restaurants, tickets, activities, travel). A primary revenue engine where it applies and aligned with value delivered; because many plans have nothing to book, commissions scale with the bookable share, not total planning volume (which is why premium and the payments take-rate matter alongside it).
- **Payments take-rate** — a small margin on pre-collection/escrow.
- **Later, B2B** — the same agent for any standing group: clubs, teams, communities, co-workers.

---

## 21. Build order / roadmap

**MVP — prove the core loop (occasion-agnostic).** Group chat + Plot; calendar availability (Google/Apple/Outlook, busy/free); in-chat research → vote → soft deadline → **locked plan** (time, place, RSVP) written to calendars; basic bill-splitting; weather; and the **non-user SMS bridge**. The loop must work for **any occasion, including plans with nothing to book** (a games night, a park meet-up, drinks at someone's place). Add **one early booking connector** — a reservation or ticketing provider (restaurants are a reasonable first pick) *with tap-to-call fallback* — so plans that need a reservation can also finish; but booking is **additive, not a launch dependency**. Focus go-to-market on **one high-frequency context: casual hangouts & nights out** (dinner, drinks, games night, a spontaneous catch-up) to build the habit.
*Exit criteria:* a real group resolves hangouts end-to-end (idea → vote → locked plan → optional booking → split) across **both** a no-booking plan (e.g., a games night) and a booked plan, with at least one non-user participating via SMS.

**V1 — make it sticky.** The autonomy/permissions layer (**Plot's Desk**) with undo + audit; **pre-collection/escrow** (Stripe Connect + KYC); memory & taste graph; recurring rituals; shared albums; proactive nudges; first richer chat surfaces (Telegram/Discord/Slack/WhatsApp); music (Spotify) and photos integrations; Strava for the Run Club archetype.
*Exit criteria:* groups return weekly; organizer-load distribution improves measurably; deposits collected with low dispute rate.

**V2 — go big.** Travel/holiday vertical; day-of live coordination + convoy; events/tickets radar; multi-group & sub-crews; the "year together" recap at scale; cinema/parking/mobility/rail integrations; booking-confirmation email parsing; premium tier GA.

---

## 22. Risks, dependencies, and open questions

**Platform/API risk.** No third-party iMessage bot API; WhatsApp template/24-hour limits; restaurant-booking APIs gated behind partnerships. *Mitigation:* lead with SMS/RCS + Telegram/Discord/Slack; secure one booking partner (prioritize TheFork for UK/EU) and ship graceful degradation everywhere.

**Regulatory.** Escrow = money transmission; KYC + PSD2/SCA in UK/EU. *Mitigation:* Stripe Connect from day one of money features; legal review before pre-collection ships.

**Trust calibration.** Over-stepping autonomy could break the group dynamic the product exists to protect. *Mitigation:* conservative defaults, visible undo/audit, and the over-cap pause; monitor undo rate and the "felt like Plot overstepped" signal.

**The "automating away friendship" risk.** *Mitigation:* the principles in §5 are binding; Plot earns its turns and stays at the edges.

**Open questions (to resolve during build).**
Which early booking/ticketing partner is realistically securable for the UK (noting booking is additive — MVP launches on general planning before any booking partner is live)? What's the default proactive-nudge frequency that re-engages without annoying? How are ledger obligations reconciled against a member's right-to-deletion? Should the runner-up always be the backup, or should the group nominate one? What's the right cross-surface protocol for "agent-to-agent" 1:1 negotiation (§H3) — does it require both parties on Plot?

---

## Appendix A — Glossary

**Plot** — the AI member of the group chat (agent + product name). **Plan object** — the long-lived stateful entity tracking a hangout from idea to memory. **Plot's Desk** — the demoted operating surface showing background work, contingencies, and the reversible activity log. **Decision object** — a votable choice (poll/ranked/boost-veto/bracket/swipe) with its own debate thread. **Soft deadline** — a gentle auto-lock ("locking at 6pm unless someone shouts"). **Non-user bridge** — the SMS/web mechanism that lets people participate without installing. **Constraint memory** — per-member, per-group facts (dietary, budget, dislikes) Plot filters on silently. **Contingency** — a declarative `if-then` rule the background runner enforces. **Graceful degradation** — handing off a tap-to-act fallback when a booking integration is unavailable.

## Appendix B — The moat, in one line

The defensibility isn't the chat or the model — those are commodities. It's the compounding layers a model provider structurally can't reach: the friend group's social graph, its collective taste and constraints, its calendars, its money flows, its shared history, and the standing authority to act. Nail the wedge — *when are we free* + *what are we doing* + *it actually happens* (a locked, on-the-calendar plan — a booking only when one's needed) — earn the group's trust, and let everything else expand from there.