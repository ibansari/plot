"""Adaptive constraint capture (PRD §A7): detect_intent (via the brain) extracts a stated constraint
and attaches the speaker; remember resolves the member and silently persists it. No network."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["PLOT_DEMO_NOW_ISO"] = "2026-06-05T18:00:00.000Z"

from plot_agent.nodes import AgentNodes
from plot_agent.brain import MessageAnalysis, StatedConstraint


class StubBrain:
    def __init__(self, analysis):
        self._analysis = analysis

    def analyze_message(self, messages):
        return self._analysis


class RememberApi:
    def __init__(self):
        self.calls = []
        self.messages = []

    def remember_constraint(self, group_id, text, kind, user_id=None, contact_id=None, expires_at=None):
        self.calls.append({"group_id": group_id, "text": text, "kind": kind,
                           "user_id": user_id, "contact_id": contact_id, "expires_at": expires_at})
        return {"remembered": True}

    def post_agent_message(self, **k):
        self.messages.append(k.get("body"))
        return {}

    # unused targets bound by the registry
    def gather_availability(self, **k): return {}
    def research_places(self, **k): return []
    def propose(self, **k): return {"id": "p"}
    def invite_non_user(self, **k): return {}
    def lock(self, **k): return {}
    def create_split(self, **k): return {"created": True, "split": {"perHeadCents": 0}}
    def maps_feasibility(self, **k): return {"status": "DEGRADED", "candidates": []}
    def get_plan(self, **k): return {}


def _ctx(body, author):
    return {
        "groupId": "g_crew",
        "members": [
            {"name": "Sam", "userId": "u_sam"},
            {"name": "Jordan", "isNonUser": True, "contactId": "c_jordan"},
        ],
        "messages": [{"authorName": author, "body": body, "isAgent": False}],
    }


def _nodes(api, analysis):
    return AgentNodes(api=api, brain=StubBrain(analysis))


def test_detect_then_remember_resolves_user():
    analysis = MessageAnalysis(decision="STAY_QUIET",
                               constraint=StatedConstraint(text="gluten-free", kind="dietary", temporary=False))
    api = RememberApi()
    nodes = _nodes(api, analysis)
    state = {"thread_id": "t", "context": _ctx("I'm gluten-free now", "Sam")}
    state.update(nodes.detect_intent(state))         # sets stated_constraint (member=Sam)
    out = nodes.remember(state)
    assert api.calls and api.calls[0]["user_id"] == "u_sam"
    assert api.calls[0]["kind"] == "dietary" and api.calls[0]["expires_at"] is None
    assert out["remembered"]["member"] == "Sam"
    assert api.messages == []  # silent — memory only


def test_temporary_constraint_gets_expiry_and_non_user():
    analysis = MessageAnalysis(decision="STAY_QUIET",
                               constraint=StatedConstraint(text="broke this month", kind="budget", temporary=True))
    api = RememberApi()
    nodes = _nodes(api, analysis)
    state = {"thread_id": "t", "context": _ctx("ugh I'm broke this month", "Jordan")}
    state.update(nodes.detect_intent(state))
    nodes.remember(state)
    assert api.calls[0]["contact_id"] == "c_jordan"
    assert api.calls[0]["expires_at"] is not None  # temporary → expiry set


def test_no_constraint_no_call():
    analysis = MessageAnalysis(decision="STAY_QUIET", constraint=None)
    api = RememberApi()
    nodes = _nodes(api, analysis)
    state = {"thread_id": "t", "context": _ctx("haha great game", "Sam")}
    state.update(nodes.detect_intent(state))
    out = nodes.remember(state)
    assert api.calls == [] and out == {}
