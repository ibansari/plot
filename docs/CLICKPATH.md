# Click-path — watch the slice

Two ways to see the exact same end-to-end flow.

## A. Headless (fastest, no iOS) — `pnpm demo`

After `./scripts/dev.sh` is up:

```bash
pnpm demo
```

You'll watch, in order:

1. **Sign-in** of the crew via OTP (dev code `000000`).
2. A **banter** message → Plot **stays quiet** (no decision card appears).
3. A **planning** message (“we should grab dinner friday night…”) → Plot detects intent, gathers
   busy/free, researches places, and **posts a decision card** with mixed options.
4. **App users vote** (Alex, Max, Sam).
5. The **non-user (Jordan)** votes through the **signed web link** — the link is printed (and also
   logged as a mock SMS in `/tmp/plot-api.log`). The vote is reconciled back into the plan.
6. The **server-side soft-deadline timer** (Inngest) fires after `PLOT_SOFT_DEADLINE_SECONDS` and
   the agent **auto-locks the leader**.
7. The **NO-BOOKING plan locks**: time + place + RSVP + auto bring-list.
8. The **audit log** prints, then the **auto-lock is undone** via its compensating action.

## B. iOS app

1. `open ios/Package.swift` → set up the App target (see `ios/README.md`) → run on an **iOS 17
   simulator**.
2. **Login**: phone is pre-filled with **Alex** `+15550000001`; tap **Text me a code** → the dev
   code `000000` auto-fills → **Verify & enter**. (Or **Sign in with Apple**.)
3. You land in **The Crew** thread with the seeded banter.
4. Type: **“we should grab dinner friday night downtown”** and send.
5. Within a couple seconds **Plot posts a decision card** (amber “needs you” border) with options
   and a **live countdown**.
6. **Tap an option** to vote — the tally updates live (over the WebSocket).
7. Meanwhile, drive the **non-user vote** from the link in `/tmp/plot-api.log` (open it in a
   browser) — the card’s tally updates in the app in real time.
8. When the countdown hits zero, the card flips to **LOCKED** showing **when / where / RSVP /
   bring-list**.
9. Tap **Audit** on the card → see every Plot action → tap **Undo** on the lock to roll it back to
   VOTING.

> The mock SMS link is printed by the API. Tail it with `tail -f /tmp/plot-api.log` and look for the
> `📱 MOCK SMS` box.
