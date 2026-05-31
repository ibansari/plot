"""Agent slice tests: intent routing (act / stay-quiet / ask), option building, and the
spend-cap gate that pauses for human approval. No network required (deterministic fallback)."""
import os
# ensure deterministic (no Claude) path
os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.llm import classify_intent
from plot_agent.tools import ToolRegistry, ApprovalRequired, build_decision_options


def msgs(*bodies):
    return [{"authorName": "Someone", "body": b, "isAgent": False} for b in bodies]


# ── detect-intent ──

def test_stay_quiet_on_banter():
    r = classify_intent(msgs("lol did everyone see the game", "Leo still owes me $5 😤"))
    assert r.decision == "STAY_QUIET"


def test_act_on_clear_plan():
    r = classify_intent(msgs("we should grab dinner friday night"))
    assert r.decision == "ACT"
    assert r.activity == "dinner"
    assert r.time_hint


def test_ask_when_underspecified():
    r = classify_intent(msgs("we should hang out sometime"))
    assert r.decision == "ASK"
    assert r.question


def test_act_with_time_only_defaults_activity():
    r = classify_intent(msgs("let's do something this weekend"))
    assert r.decision == "ACT"


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
