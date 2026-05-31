"""The remember node resolves the speaker to a member and silently persists a stated constraint
(PRD §A7). It never posts to the thread. No network — a fake API captures the persist call."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["PLOT_DEMO_NOW_ISO"] = "2026-06-05T18:00:00.000Z"

from plot_agent.nodes import AgentNodes


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


def _ctx(body, author):
    return {
        "groupId": "g_crew",
        "members": [
            {"name": "Sam", "userId": "u_sam"},
            {"name": "Jordan", "isNonUser": True, "contactId": "c_jordan"},
        ],
        "messages": [{"authorName": author, "body": body, "isAgent": False}],
    }


def test_remembers_and_resolves_user():
    api = RememberApi()
    out = AgentNodes(api=api).remember({"thread_id": "t", "context": _ctx("I'm gluten-free now", "Sam")})
    assert api.calls and api.calls[0]["user_id"] == "u_sam"
    assert api.calls[0]["kind"] == "dietary"
    assert out["remembered"]["member"] == "Sam"
    assert api.messages == []  # silent — memory only


def test_resolves_non_user_contact_and_expiry():
    api = RememberApi()
    AgentNodes(api=api).remember({"thread_id": "t", "context": _ctx("ugh I'm broke this month", "Jordan")})
    assert api.calls[0]["contact_id"] == "c_jordan"
    assert api.calls[0]["expires_at"] is not None


def test_no_constraint_no_call():
    api = RememberApi()
    out = AgentNodes(api=api).remember({"thread_id": "t", "context": _ctx("haha that was a great game", "Sam")})
    assert api.calls == []
    assert out == {}
