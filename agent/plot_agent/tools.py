"""Typed tool registry. Every tool declares the permission scope it needs and whether it is
irreversible/spends money. `invoke()` enforces the gate BEFORE running (default-deny on missing
permission; pause-for-approval when over the spend cap). The audit row is written AFTER, server-side
by the API endpoint each tool calls — so audit is inseparable from the action."""
from __future__ import annotations
import inspect
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Any
from .api_client import ApiClient


class ApprovalRequired(Exception):
    """Raised when a tool would exceed the spend cap or is irreversible — routes to human-approval."""
    def __init__(self, summary: str, amount_cents: int = 0):
        super().__init__(summary)
        self.summary = summary
        self.amount_cents = amount_cents


@dataclass
class Tool:
    name: str
    scope: str           # PermissionScope the tool needs (informational; API also enforces)
    irreversible: bool   # irreversible tools always route to human-approval
    spends: bool         # whether this tool spends money (cap-gated)
    run: Callable[..., Any]
    # ── agentic-loop exposure (Claude tool use) ──
    description: str = ""           # WHEN to call it (prescriptive — drives Claude's choice)
    input_schema: dict | None = None  # JSON schema of the args Claude provides (context is injected by the loop)
    loop: bool = False              # offered to the agentic message-loop
    proactive: bool = False         # also offered on an uninvited (proactive) turn — read/speak only
    external: bool = False          # an MCP-server tool: the loop dispatches its args straight through invoke()


class ToolRegistry:
    def __init__(self, api: ApiClient):
        self.api = api
        self._tools: dict[str, Tool] = {}
        self._register_defaults()

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def invoke(self, name: str, *, plan_id: str | None = None, amount_cents: int = 0, **kwargs):
        tool = self._tools[name]
        # ── gate BEFORE ──
        if tool.irreversible:
            raise ApprovalRequired(f"{name} is irreversible — needs approval", amount_cents)
        if tool.spends:
            if plan_id is None:
                raise ApprovalRequired(f"{name} spends but no plan context", amount_cents)
            check = self.api.check_spend(plan_id, amount_cents)
            if not check.get("allowed"):
                raise ApprovalRequired(
                    f"{name} would spend {amount_cents}c, over the cap (remaining {check.get('remaining')}c)",
                    amount_cents,
                )
        # ── run (the API writes the audit row) ──
        # forward plan_id into the call iff the run target accepts it (signatures vary by tool)
        try:
            params = inspect.signature(tool.run).parameters
            if plan_id is not None and "plan_id" in params and "plan_id" not in kwargs:
                kwargs["plan_id"] = plan_id
        except (TypeError, ValueError):
            pass
        return tool.run(**kwargs)

    # tools Claude can call inside the agentic loop, in Anthropic tool-use format.
    # On a proactive (uninvited) turn, only read/speak tools are offered — mutating tools are
    # physically withheld from the schema, so an uninvited turn can suggest but never commit.
    def tool_schemas(self, trigger: str = "message") -> list[dict]:
        out = []
        for t in self._tools.values():
            if not t.loop:
                continue
            if trigger == "proactive" and not t.proactive:
                continue
            out.append({"name": t.name, "description": t.description, "input_schema": t.input_schema or {"type": "object", "properties": {}}})
        return out

    def _register_defaults(self):
        # ── availability / research (read; permission-gated server-side, degrade to empty) ──
        self.register(Tool(
            "gather_availability", "CALENDAR_BUSYFREE", False, False, self.api.gather_availability,
            description="Find when the group is free. Call this when a plan needs a time and you don't have one yet. YOU choose the window (tonight 6–11pm, this Friday evening, a full Saturday for a trip day).",
            input_schema={"type": "object", "properties": {
                "from_iso": {"type": "string", "description": "window start, ISO-8601"},
                "to_iso": {"type": "string", "description": "window end, ISO-8601"},
            }, "required": ["from_iso", "to_iso"]},
            loop=True, proactive=True,
        ))
        self.register(Tool(
            "research_places", "PLACES_SEARCH", False, False, self.api.research_places,
            description="Search real venues/activities. Call once per kind of place you need (e.g. 'sushi', or 'lodging big sur' then 'hiking trail'). Returns name, price tier, address.",
            input_schema={"type": "object", "properties": {
                "query": {"type": "string", "description": "what to search, e.g. 'sushi', 'rooftop bar', 'bowling'"},
                "near": {"type": "string", "description": "optional area"},
            }, "required": ["query"]},
            loop=True, proactive=True,
        ))
        self.register(Tool(
            "maps_feasibility", "PLACES_SEARCH", False, False, self.api.maps_feasibility,
            description="PREFERRED for in-person venue planning: searches real venues AND returns each member's travel time + a fairness ranking (named ETAs, no private locations). Use this instead of research_places whenever location/travel matters, so you can pick a spot that's fair to everyone. Venues that break a member's hard travel limit are already removed; soft warnings are annotated.",
            input_schema={"type": "object", "properties": {
                "query": {"type": "string", "description": "what to search, e.g. 'sushi', 'cabin catskills'"},
                "near": {"type": "string", "description": "optional area/anchor"},
            }, "required": ["query"]},
            loop=True, proactive=True,
        ))
        self.register(Tool(
            "get_plan", "", False, False, self.api.get_plan,
            description="Read a plan's current options, votes, and state. Call before refining or to check where a decision stands.",
            input_schema={"type": "object", "properties": {"plan_id": {"type": "string"}}, "required": ["plan_id"]},
            loop=True, proactive=True,
        ))
        # ── propose a decision (reversible draft; the group explicitly opens voting) ──
        self.register(Tool(
            "propose_plan", "", False, False, self.api.propose,
            description="Draft a concrete decision card with 2–4 options for the group to review before voting. Use after you know roughly when + what. Write a friendly card 'summary' (start with ✦) that leads with your top pick and references the group's constraints, and a 'why' on each option.",
            input_schema={"type": "object", "properties": {
                "title": {"type": "string"},
                "method": {"type": "string", "enum": ["boost_veto", "ranked"]},
                "summary": {"type": "string", "description": "the decision-card body; starts with ✦"},
                "options": {"type": "array", "items": {"type": "object", "properties": {
                    "kind": {"type": "string", "enum": ["COMBO", "TIME", "PLACE", "ACTIVITY"]},
                    "label": {"type": "string"},
                    "place": {"type": "string"},
                    "priceTier": {"type": "integer"},
                    "startsAt": {"type": "string"},
                    "endsAt": {"type": "string"},
                    "why": {"type": "string", "description": "why it fits THIS group, referencing a constraint when one applies"},
                    "fitFlags": {"type": "array", "items": {"type": "string"}},
                }, "required": ["kind", "label"]}},
            }, "required": ["title", "method", "summary", "options"]},
            loop=True,
        ))
        # ── speech: the only casual channel (clarifying Qs, callouts). Calling it 0 times = silence ──
        self.register(Tool(
            "post_message", "", False, False, self.api.post_agent_message,
            description="Say something in the thread — a single clarifying question when intent is unclear, a heads-up about a constraint conflict, or a nudge. This is the ONLY way you speak. Keep it short and warm; don't narrate.",
            input_schema={"type": "object", "properties": {
                "body": {"type": "string"},
                "plan_id": {"type": "string"},
            }, "required": ["body"]},
            loop=True, proactive=True,
        ))
        # ── control: end the turn (default silence is a first-class clean stop) ──
        self.register(Tool(
            "finish_turn", "", False, False, lambda **_kw: {"ok": True},
            description="End your turn. Call this when you've done everything useful for now — including when the right move is to stay silent (banter, settled logistics, nothing to add).",
            input_schema={"type": "object", "properties": {"reason": {"type": "string"}}},
            loop=True, proactive=True,
        ))
        # ── deadline/money path tools (NOT offered to the loop; used by the Inngest deadline chain) ──
        self.register(Tool("invite_non_user", "SEND_NONUSER_INVITE", False, False, self.api.invite_non_user))
        self.register(Tool("lock_plan", "", False, False, self.api.lock))
        self.register(Tool("create_split", "SPEND_MONEY", False, False, self.api.create_split))
        self.register(Tool("remember_constraint", "", False, False, self.api.remember_constraint))
        # booking is irreversible → always routes to human-approval (scaffolded)
        self.register(Tool("book_venue", "BOOK_VENUE", True, False, lambda **_kw: None))


# ── option builder (the propose-decision node uses this) ──

def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%a %-I:%M%p").replace(":00", "")


def build_decision_options(
    availability: dict,
    places: list[dict],
    activity: str | None,
) -> list[dict]:
    """Assemble MIXED candidate options: time+place COMBOs, a time-only alternative, and an activity
    option, so the card offers genuinely different choices. Returns >=2 options for a valid vote.

    This is pure assembly. The "why it fits this group" rationale, poor-fit flags, and best-fit
    ranking are reasoned by the LLM brain (see brain.reason_about_options / apply_reasoning)."""
    slots = availability.get("suggestions") or []
    # fallback slot if availability is empty: tomorrow 7:30pm for 90m
    if not slots:
        base = _parse(availability.get("windowFrom") or datetime.now(timezone.utc).isoformat())
        s = base.replace(minute=30, second=0, microsecond=0) + timedelta(hours=1, minutes=30)
        slots = [{"startsAt": s.isoformat(), "endsAt": (s + timedelta(minutes=90)).isoformat(), "freeCount": 0}]

    options: list[dict] = []
    top_slot = slots[0]
    for place in places[:2]:
        options.append({
            "kind": "COMBO",
            "label": f"{_fmt(_parse(top_slot['startsAt']))} @ {place['name']}",
            "startsAt": top_slot["startsAt"],
            "endsAt": top_slot["endsAt"],
            "place": place["name"],
            "priceTier": place.get("priceTier", 2),
        })
    # a second time slot as a time-only alternative
    if len(slots) > 1:
        alt = slots[1]
        options.append({
            "kind": "TIME",
            "label": f"Alt time: {_fmt(_parse(alt['startsAt']))}",
            "startsAt": alt["startsAt"],
            "endsAt": alt["endsAt"],
        })
    # an activity option to round out the mix
    options.append({"kind": "ACTIVITY", "label": f"Keep it casual: {activity or 'hang out'}"})

    # guarantee >=2 distinct options
    while len(options) < 2:
        options.append({"kind": "ACTIVITY", "label": f"Option {len(options)+1}"})
    return options[:4]
