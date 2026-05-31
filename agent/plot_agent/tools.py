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

    def _register_defaults(self):
        self.register(Tool("gather_availability", "CALENDAR_BUSYFREE", False, False, self.api.gather_availability))
        self.register(Tool("research_places", "PLACES_SEARCH", False, False, self.api.research_places))
        self.register(Tool("propose_plan", "", False, False, self.api.propose))
        self.register(Tool("invite_non_user", "SEND_NONUSER_INVITE", False, False, self.api.invite_non_user))
        self.register(Tool("lock_plan", "", False, False, self.api.lock))
        self.register(Tool("post_message", "", False, False, self.api.post_agent_message))
        # auto-split (§B1): collecting shares is REVERSIBLE (refund) and not an over-cap spend, so
        # the registry doesn't gate it — the API enforces the SPEND_MONEY grant (default-deny).
        self.register(Tool("create_split", "SPEND_MONEY", False, False, self.api.create_split))
        # remembering a constraint is reversible memory, not a world action — no gate.
        self.register(Tool("remember_constraint", "", False, False, self.api.remember_constraint))
        # booking is irreversible → always routes to human-approval (scaffolded, not used in slice)
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
    constraints: list | None = None,
) -> list[dict]:
    """Build MIXED options: time+place COMBOs, plus a time-only and an activity option so the card
    offers genuinely different choices. Returns >=2 options for a valid vote.

    When `constraints` (a list of MemberConstraint) are supplied, each COMBO carries a "why it fits
    this group" line + poor-fit flags (PRD §A2), places are ranked best-fit first, and a place a
    member hard-dislikes is silently dropped when alternatives remain (PRD §A7)."""
    from .constraints import evaluate_place

    slots = availability.get("suggestions") or []
    # fallback slot if availability is empty: tomorrow 7:30pm for 90m
    if not slots:
        base = _parse(availability.get("windowFrom") or datetime.now(timezone.utc).isoformat())
        s = base.replace(minute=30, second=0, microsecond=0) + timedelta(hours=1, minutes=30)
        slots = [{"startsAt": s.isoformat(), "endsAt": (s + timedelta(minutes=90)).isoformat(), "freeCount": 0}]

    constraints = constraints or []
    # score every place, rank best-fit first, then silently drop hard vetoes when alternatives exist
    scored = [(p, evaluate_place(p, constraints)) for p in places]
    scored.sort(key=lambda ps: ps[1]["fit"], reverse=True)
    non_veto = [ps for ps in scored if not ps[1]["veto"]]
    ranked = non_veto if len(non_veto) >= 1 else scored

    options: list[dict] = []
    top_slot = slots[0]
    for place, fit in ranked[:2]:
        opt = {
            "kind": "COMBO",
            "label": f"{_fmt(_parse(top_slot['startsAt']))} @ {place['name']}",
            "startsAt": top_slot["startsAt"],
            "endsAt": top_slot["endsAt"],
            "place": place["name"],
            "priceTier": place.get("priceTier", 2),
            "why": fit["why"],
        }
        if fit["flags"]:
            opt["fitFlags"] = fit["flags"]
        options.append(opt)
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
