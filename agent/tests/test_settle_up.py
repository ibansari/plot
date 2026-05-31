"""Auto-split on lock (PRD §B1). After a costed plan locks, the settle-up node creates an even
split when the group granted money access, and otherwise asks in-thread instead of moving money
(least authority, §13). A free hang (someone's place) is skipped. No network — fake API."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.nodes import AgentNodes


class SplitApi:
    """Fake API capturing split + message calls. `granted` toggles the SPEND_MONEY grant."""

    def __init__(self, granted=True):
        self.granted = granted
        self.messages = []
        self.split_calls = []

    def create_split(self, plan_id, per_head_cents, memo=None):
        self.split_calls.append({"plan_id": plan_id, "perHeadCents": per_head_cents, "memo": memo})
        if not self.granted:
            return {"created": False, "needsPermission": True, "scope": "SPEND_MONEY"}
        return {"created": True, "split": {"id": "sp1", "perHeadCents": per_head_cents, "state": "HELD"}}

    def post_agent_message(self, thread_id, body, kind="AGENT", plan_id=None):
        self.messages.append(body)
        return {"id": "m1"}

    # unused tool targets (bound by the registry at construction)
    def gather_availability(self, **k):
        return {}

    def research_places(self, **k):
        return []

    def propose(self, **k):
        return {"id": "p"}

    def invite_non_user(self, **k):
        return {}

    def lock(self, **k):
        return {}

    def remember_constraint(self, **k):
        return {"remembered": True}

    def weather_check(self, **k): return {"status": "DEGRADED", "summary": "n/a"}
    def maps_feasibility(self, **k): return {"status": "DEGRADED", "candidates": []}
    def get_plan(self, **k):
        return {}


def _state(has_cost=True, tier=3):
    return {"thread_id": "t1", "plan_id": "p1", "leader_has_cost": has_cost,
            "leader_price_tier": tier, "leader_label": "Fri 7:30p @ Lucia"}


def test_split_created_when_money_granted():
    api = SplitApi(granted=True)
    out = AgentNodes(api=api).settle_up(_state(tier=3))
    assert out["result"] == "LOCKED_AND_SPLIT"
    assert api.split_calls[0]["perHeadCents"] == 6000  # tier 3 → $60pp
    assert any("split" in m.lower() and "$60" in m for m in api.messages)


def test_asks_for_permission_when_money_not_granted():
    api = SplitApi(granted=False)
    out = AgentNodes(api=api).settle_up(_state())
    assert out["result"] == "LOCKED_SPLIT_NEEDS_PERMISSION"
    # no money moved, but Plot asked in-thread
    assert any("money access" in m.lower() or "grant" in m.lower() for m in api.messages)


def test_free_hang_is_not_split():
    api = SplitApi(granted=True)
    out = AgentNodes(api=api).settle_up(_state(has_cost=False))
    assert out["result"] == "LOCKED"
    assert api.split_calls == []
    assert api.messages == []
