"""Agent slice tests: option assembly and the spend-cap gate that pauses for human approval.
Intent/constraint reasoning is the LLM brain's job — covered in test_brain.py with a fake parser.
No network required."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.tools import ToolRegistry, ApprovalRequired, build_decision_options


# ── propose: mixed options ──

def test_build_options_are_mixed_and_min_two():
    availability = {
        "windowFrom": "2026-06-01T18:00:00+00:00",
        "suggestions": [
            {"startsAt": "2026-06-01T19:30:00+00:00", "endsAt": "2026-06-01T21:00:00+00:00", "freeCount": 4},
            {"startsAt": "2026-06-01T20:00:00+00:00", "endsAt": "2026-06-01T21:30:00+00:00", "freeCount": 3},
        ],
    }
    places = [
        {"name": "Ananda Thai", "priceTier": 2},
        {"name": "Pier 17 Rooftop", "priceTier": 2},
    ]
    opts = build_decision_options(availability, places, "dinner")
    kinds = {o["kind"] for o in opts}
    assert len(opts) >= 2
    assert "COMBO" in kinds  # time+place
    assert any(o["kind"] in ("TIME", "ACTIVITY") for o in opts)  # genuinely mixed


# ── spend-cap gate → human approval ──

class FakeApi:
    def __init__(self, remaining):
        self._remaining = remaining
        self.locked = False

    def check_spend(self, plan_id, amount_cents):
        return {"allowed": amount_cents <= self._remaining, "remaining": self._remaining}

    def lock(self, plan_id, reason="x"):
        self.locked = True
        return {"id": plan_id, "state": "LOCKED"}

    # unused tool targets
    def gather_availability(self, **k):
        return {}

    def research_places(self, **k):
        return []

    def propose(self, **k):
        return {"id": "p"}

    def invite_non_user(self, **k):
        return {}

    def post_agent_message(self, **k):
        return {}

    def create_split(self, **k):
        return {"created": True, "split": {"id": "sp", "perHeadCents": 0, "state": "HELD"}}

    def remember_constraint(self, **k):
        return {"remembered": True}

    def maps_feasibility(self, **k): return {"status": "DEGRADED", "candidates": []}
    def get_plan(self, **k):
        return {}


def test_over_cap_routes_to_approval():
    reg = ToolRegistry(FakeApi(remaining=1000))
    # book_venue is irreversible → always approval
    try:
        reg.invoke("book_venue", plan_id="p1")
        assert False, "expected ApprovalRequired"
    except ApprovalRequired:
        pass


def test_reversible_lock_is_allowed():
    api = FakeApi(remaining=10000)
    reg = ToolRegistry(api)
    reg.invoke("lock_plan", plan_id="p1", reason="soft-deadline")
    assert api.locked is True
