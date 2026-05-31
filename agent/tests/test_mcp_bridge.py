"""MCP bridge (PRD: pull real capabilities — Google Calendar / Maps / Resy — into the loop).

A fake hub stands in for the async MCP transport, so registration + gating + loop dispatch are tested
offline with no `mcp` package and no live server. The key invariant: a server's READ tools are
exposed to the loop ungated, while its `mutating` tools (book/reserve) are irreversible → they route
to human-approval through the SAME ToolRegistry gate."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.tools import ToolRegistry, ApprovalRequired
from plot_agent.mcp_bridge import register_mcp_tools


class FakeApi:
    def maps_feasibility(self, **k): return {"status": "DEGRADED", "candidates": []}
    def get_plan(self, **k):
        return {}
    # registry binds these at construction
    def gather_availability(self, **k): return {}
    def research_places(self, **k): return []
    def propose(self, **k): return {"id": "p"}
    def invite_non_user(self, **k): return {}
    def lock(self, **k): return {}
    def post_agent_message(self, **k): return {}
    def create_split(self, **k): return {}
    def remember_constraint(self, **k): return {}


class FakeHub:
    """Stands in for McpHub — a Resy-like server with a read `search` tool and a mutating `book`."""
    def __init__(self):
        self.calls = []

    def list_tools(self, name):
        return [
            {"name": "search_restaurants", "description": "find tables", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}},
            {"name": "book_reservation", "description": "book a table", "inputSchema": {"type": "object", "properties": {"venue": {"type": "string"}}}},
        ]

    def call_tool(self, name, tool, args):
        self.calls.append((name, tool, args))
        return {"content": f"{tool} ok", "isError": False}


SERVERS = [{"name": "resy", "transport": "stdio", "command": "x", "mutating": ["book_reservation"]}]


def _registry():
    return ToolRegistry(FakeApi())


def test_read_tool_registered_and_exposed_to_loop():
    reg = _registry()
    n = register_mcp_tools(reg, FakeHub(), SERVERS)
    assert n == 2
    loop_names = [t["name"] for t in reg.tool_schemas("message")]
    assert "resy__search_restaurants" in loop_names
    # mutating tool is still offered to the loop (Claude may try it) — the GATE stops it, not the schema
    assert "resy__book_reservation" in loop_names
    # but it is withheld on a proactive (uninvited) turn
    assert "resy__book_reservation" not in [t["name"] for t in reg.tool_schemas("proactive")]


def test_read_tool_invokes_through_registry():
    reg = _registry()
    hub = FakeHub()
    register_mcp_tools(reg, hub, SERVERS)
    out = reg.invoke("resy__search_restaurants", query="sushi downtown")
    assert out["content"] == "search_restaurants ok"
    assert hub.calls == [("resy", "search_restaurants", {"query": "sushi downtown"})]


def test_mutating_tool_is_gated_to_human_approval():
    reg = _registry()
    hub = FakeHub()
    register_mcp_tools(reg, hub, SERVERS)
    try:
        reg.invoke("resy__book_reservation", venue="Sushi Nakazawa")
        assert False, "expected ApprovalRequired — booking must route to human approval"
    except ApprovalRequired:
        pass
    assert hub.calls == []  # the world action never ran


def test_loop_can_call_an_mcp_tool():
    # the agentic loop dispatches a registered MCP tool through invoke()
    from types import SimpleNamespace
    from plot_agent.nodes import AgentNodes
    from plot_agent.brain import Brain

    hub = FakeHub()

    class LoopApi(FakeApi):
        def context(self, tid): return CTX

    api = LoopApi()
    nodes = AgentNodes(api=api, brain=Brain(loop_caller=None))
    register_mcp_tools(nodes.tools, hub, SERVERS)

    def caller(system, messages, tools):
        # step 1: call the MCP read tool; step 2: finish
        if not getattr(caller, "done", False):
            caller.done = True
            return SimpleNamespace(content=[SimpleNamespace(type="tool_use", id="t1", name="resy__search_restaurants", input={"query": "sushi"})], stop_reason="tool_use")
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", id="t2", name="finish_turn", input={})], stop_reason="tool_use")

    nodes.brain._loop_caller = caller
    CTX = {"groupId": "g", "members": [{"name": "Alex", "userId": "u_alex"}], "messages": [{"authorName": "Alex", "body": "sushi?", "isAgent": False}]}
    nodes.agent_loop({"thread_id": "t", "trigger": "message", "context": CTX, "intent": {"decision": "ACT"}})
    assert ("resy", "search_restaurants", {"query": "sushi"}) in hub.calls
