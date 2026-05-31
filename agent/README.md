# agent — PLOT planning agent (FastAPI + LangGraph)

A separate Python service. The API triggers `POST /run` on every human message; Inngest re-enters
`POST /run` with `trigger="deadline"` at the soft deadline to auto-lock.

## Graph (PRD §9)

```
message:   dispatch → remember → detect-intent ─┬─ stay-quiet
                                                ├─ ask
                                                └─ gather-availability → research → propose-decision
deadline:  dispatch → act-or-ask ─┬─ act → settle-up        (auto-lock leader, then offer a split)
                                  └─ human-approval         (over-cap / irreversible)
```

`detect-intent` decides **ACT / STAY_QUIET / ASK**. With `ANTHROPIC_API_KEY` set it's Claude
tool-use; with no key it's a deterministic keyword classifier (`llm.py`) — same output shape, so
the whole slice runs offline.

**What Plot reasons about (all pure + unit-tested, so the intelligence runs offline):**

- **`remember` (§A7)** — silently learns a constraint a member states in chat ("I'm vegetarian
  now", "I'm broke this month" → expires), persisting it to their membership. Never speaks.
- **Constraint memory + fit rationale (`constraints.py`, §A2/§A7)** — each proposed option carries
  a *"why it fits this group"* line referencing a real constraint, poor fits are **flagged** with a
  reason, a hard-disliked place is **silently dropped**, and options are ranked best-fit-first.
- **Proposal voice + decision method (`summary.py`, §A2/§A3)** — picks boost/veto vs ranked by
  option count and writes the decision-card body so the group sees Plot's reasoning, not a generic card.
- **`settle-up` (§B1)** — after a costed lock, sets up an even split; money is least-authority, so
  without the `SPEND_MONEY` grant it asks in-thread instead of moving money.

Every tool goes through the typed registry (`tools.py`), which **checks permission / spend-cap
BEFORE** running; irreversible or over-cap calls raise `ApprovalRequired` → the graph's
`human-approval` node. The **audit row is written AFTER**, server-side, by the API endpoint each
tool calls — so an action and its audit are inseparable.

## Run

```bash
cd agent
uv venv && uv pip install -e ".[dev,postgres]"   # or: python -m venv .venv && pip install -e ".[dev,postgres]"
uv run uvicorn plot_agent.main:app --port 8000    # serves /run and /health
uv run pytest                                     # routing + option + spend-cap tests (no network)
```

> Postgres checkpointer is used when reachable; otherwise it falls back to `MemorySaver`.
> Python 3.11+ recommended.
