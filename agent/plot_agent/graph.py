"""Explicit LangGraph state machine (PRD §9):

  dispatch ─(trigger)─▶ remember ─▶ detect-intent ─┬─ STAY_QUIET ─▶ END
                                        ├─ ASK ────────▶ ask ─▶ END
                                        └─ ACT ────────▶ gather-availability ─▶ research
                                                            ─▶ propose-decision ─▶ END (await votes)
  dispatch ─(deadline)─▶ act-or-ask ─┬─ act ─▶ settle-up ─▶ END   (auto-lock leader, then split §B1)
                                     └─ approve ─────────▶ human-approval ─▶ END

The durable workflow (Inngest) re-enters the graph with trigger='deadline' after the soft deadline.
A Postgres checkpointer persists graph state across those re-entries (falls back to in-memory)."""
from __future__ import annotations
from typing import Any, TypedDict, Optional
from langgraph.graph import StateGraph, START, END
from .nodes import AgentNodes
from . import config


class AgentState(TypedDict, total=False):
    thread_id: str
    plan_id: Optional[str]
    trigger: str  # "message" | "confirmed_intent" | "deadline"
    context: dict
    remembered: dict
    intent: dict
    availability: dict
    places: list
    activity: str
    invited: list
    act_decision: str
    estimate_cents: int
    leader_label: str
    leader_has_cost: bool
    leader_price_tier: int
    split: dict
    decision: str
    result: str


def _checkpointer():
    """Postgres checkpointer if available + reachable, else in-memory (slice still runs)."""
    try:
        from langgraph.checkpoint.postgres import PostgresSaver

        if config.DATABASE_URL:
            cp = PostgresSaver.from_conn_string(config.DATABASE_URL)
            cp.setup()
            return cp
    except Exception:
        pass
    from langgraph.checkpoint.memory import MemorySaver

    return MemorySaver()


def build_graph(nodes: AgentNodes | None = None):
    n = nodes or AgentNodes()
    g = StateGraph(AgentState)

    g.add_node("dispatch", n.dispatch)
    g.add_node("remember", n.remember)
    g.add_node("detect_intent", n.detect_intent)
    g.add_node("stay_quiet", n.stay_quiet)
    g.add_node("suggest_plan", n.suggest_plan)
    g.add_node("agent_loop", n.agent_loop)
    # deadline / money path — trust-critical, kept exactly as-is
    g.add_node("act_or_ask", n.act_or_ask)
    g.add_node("act", n.act)
    g.add_node("settle_up", n.settle_up)
    g.add_node("human_approval", n.human_approval)

    g.add_edge(START, "dispatch")
    g.add_conditional_edges(
        "dispatch",
        lambda s: "deadline" if s.get("trigger") == "deadline" else "intent",
        {"deadline": "act_or_ask", "intent": "detect_intent"},
    )
    # message path: a cheap structured read gates banter (silence == no action), persists any stated
    # constraint, then hands ACT/ASK to the agentic loop where Claude chooses tools freely.
    g.add_edge("detect_intent", "remember")
    g.add_conditional_edges(
        "remember",
        n.route_after_remember,
        {"quiet": "stay_quiet", "suggest": "suggest_plan", "loop": "agent_loop"},
    )
    g.add_edge("agent_loop", END)
    g.add_edge("stay_quiet", END)
    g.add_edge("suggest_plan", END)
    g.add_conditional_edges(
        "act_or_ask",
        lambda s: s.get("act_decision", "act"),
        {"act": "act", "approve": "human_approval"},
    )
    g.add_conditional_edges(
        "act",
        lambda s: "settle" if s.get("result") == "LOCKED" else "done",
        {"settle": "settle_up", "done": END},
    )
    g.add_edge("settle_up", END)
    g.add_edge("human_approval", END)

    return g.compile(checkpointer=_checkpointer())
