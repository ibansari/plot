# agent — PLOT planning agent (FastAPI + LangGraph)

A separate Python service. The API triggers `POST /run` on every human message; Inngest re-enters
`POST /run` with `trigger="deadline"` at the soft deadline to auto-lock.

## Architecture — Claude drives an agentic tool-use loop

```
message:   dispatch → detect-intent → remember ─┬─ stay-quiet        (banter → silence, cheap gate)
                                                └─ AGENT LOOP ─▶ END   (Claude picks tools freely)
deadline:  dispatch → act-or-ask ─┬─ act → settle-up        (auto-lock leader, then offer a split)
                                  └─ human-approval         (over-cap / irreversible)
```

The message path is **not a fixed pipeline**. A cheap structured call gates banter (silence costs
one small classification, never the loop) and captures any stated constraint; everything else enters
**`loop.py:AgentLoop`**, where Claude (`claude-opus-4-8`, tool use) sees the live thread + the group's
constraints + a real toolset and **decides which tools to call and in what order** — so "sushi
tonight", an open question, and a multi-turn trip/itinerary discussion all run through the same loop.

**Tools Claude has (`tools.py`, Anthropic tool-use schemas):** `gather_availability` (Claude picks the
window), `research_places` (live OSM; called once per kind of place), `get_plan` (read state),
`propose_plan` (open a votable decision; the loop auto-invites non-users), `post_message` (the only
speech channel — clarifying Qs, nudges), `finish_turn` (explicit stop; default silence). On an
uninvited **proactive** turn the dispatcher physically withholds mutating tools (allowlist), so Plot
can suggest but never commit.

**The brain (`brain.py`).** Two SDK seams, both `claude-opus-4-8` with a cached persona prompt:
`run_loop_step` (the tool-use loop) and `messages.parse`+Pydantic for the structured `analyze_message`
(banter gate + constraint extraction) and `reason_about_options` (deterministic-fallback ranking).
Both seams are injectable, so the whole agent — loop included — is unit-tested offline with a fake.

**Trust is unchanged — it never lived in the graph topology.** Every tool the loop calls still flows
through `ToolRegistry.invoke()` (permission / spend-cap / irreversible gate **BEFORE**; an over-cap or
irreversible call raises `ApprovalRequired`, which the loop converts to a "blocked — needs approval"
tool result Claude cannot act around) and the API writes the audit row **AFTER**. Hard stops
(`MAX_STEPS`, per-turn mutating ceilings) are enforced in `loop.py`, never by trusting the model. The
trust-critical **deadline/money path is kept verbatim**.

Requires `ANTHROPIC_API_KEY`. With no key (or on an API error) the loop falls back to the deterministic
gather→research→propose path — the agent never crashes and never acts un-gated.

## MCP — pull in real capabilities (`mcp_bridge.py`)

Plot can connect to **MCP servers** (Google Calendar, Google Maps, Resy/OpenTable, Ticketmaster…) and
expose their tools to the loop. Set `PLOT_MCP_SERVERS` (JSON; see `.env.example`) and `pip install
plot-agent[mcp]`. Each server is connected once at startup; its tools are registered into the **same
`ToolRegistry`**, so they flow through the trust gate: a tool named in the server's `mutating` list
(`book_reservation`, `create-event`, `pay`) is registered **irreversible → human-approval**; every
other (read) tool is offered to the loop directly (and withheld on proactive turns). Claude then calls
them like any built-in tool. Nothing is configured by default — the agent is unchanged until you opt
in. Verified live against the reference `@modelcontextprotocol/server-everything` server; the
domain servers above just need their credentials in the config.

## Run

```bash
cd agent
uv venv && uv pip install -e ".[dev,postgres]"   # or: python -m venv .venv && pip install -e ".[dev,postgres]"
uv run uvicorn plot_agent.main:app --port 8000    # serves /run and /health
uv run pytest                                     # routing + option + spend-cap tests (no network)
```

> Postgres checkpointer is used when reachable; otherwise it falls back to `MemorySaver`.
> Python 3.11+ recommended.
