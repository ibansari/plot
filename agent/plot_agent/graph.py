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
    trigger: str  # "message" | "deadline"
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
    g.add_node("ask", n.ask)
    g.add_node("gather_availability", n.gather_availability)
    g.add_node("research", n.research)
    g.add_node("propose_decision", n.propose_decision)
    g.add_node("act_or_ask", n.act_or_ask)
    g.add_node("act", n.act)
    g.add_node("settle_up", n.settle_up)
    g.add_node("human_approval", n.human_approval)

    g.add_edge(START, "dispatch")
    g.add_conditional_edges(
        "dispatch",
        lambda s: "deadline" if s.get("trigger") == "deadline" else "intent",
        {"deadline": "act_or_ask", "intent": "remember"},
    )
    # message path: learn any stated constraint first, then classify intent
    g.add_edge("remember", "detect_intent")
    g.add_conditional_edges(
        "detect_intent",
        lambda s: s["intent"]["decision"],
        {"STAY_QUIET": "stay_quiet", "ASK": "ask", "ACT": "gather_availability"},
    )
    g.add_edge("gather_availability", "research")
    g.add_edge("research", "propose_decision")
    g.add_edge("propose_decision", END)
    g.add_edge("stay_quiet", END)
    g.add_edge("ask", END)
    g.add_conditional_edges(
        "act_or_ask",
        lambda s: s.get("act_decision", "act"),
        {"act": "act", "approve": "human_approval"},
    )
    g.add_edge("act", "settle_up")
    g.add_edge("settle_up", END)
    g.add_edge("human_approval", END)

    return g.compile(checkpointer=_checkpointer())
