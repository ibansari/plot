"""Wiring test: the propose-decision node pulls member constraints off the thread context and the
resulting proposed options carry the fit rationale + flags (PRD §A2/§A7). No network — a fake API
captures the propose payload."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["PLOT_DEMO_NOW_ISO"] = "2026-06-05T18:00:00.000Z"  # before Jordan's budget expiry

from plot_agent.nodes import AgentNodes
from plot_agent.brain import ProposalReasoning, OptionAssessment


class StubBrain:
    """Stands in for the LLM: assesses the actually-assembled options (best-fit Thai, flagged Lucia)."""

    def reason_about_options(self, activity, time_hint, options, constraints):
        assessments = []
        for o in options:
            place = o.get("place", "")
            if "Ananda" in place:
                assessments.append(OptionAssessment(label=o["label"], why="gluten-free options for Sam; cheap-ish for Jordan", fit=5))
            elif "Lucia" in place:
                assessments.append(OptionAssessment(label=o["label"], why="a treat", flags=["over Jordan's budget ($$$$)"], fit=-2))
            else:
                assessments.append(OptionAssessment(label=o["label"], why="an easy option", fit=0))
        return ProposalReasoning(
            method="ranked",
            summary="✦ Found a couple of dinner options for friday night. My pick: Ananda Thai — gluten-free options for Sam; cheap-ish for Jordan.",
            assessments=assessments,
        )


class CaptureApi:
    def __init__(self):
        self.proposed = None

    def propose(self, payload):
        self.proposed = payload
        return {"id": "p_test"}

    def invite_non_user(self, plan_id, contact_id, purpose="vote"):
        return {"ok": True}

    # unused tool targets (bound by the registry at construction)
    def gather_availability(self, **k):
        return {}

    def research_places(self, **k):
        return []

    def lock(self, **k):
        return {}

    def post_agent_message(self, **k):
        return {}

    def create_split(self, **k):
        return {"created": True, "split": {"id": "sp", "perHeadCents": 0, "state": "HELD"}}

    def remember_constraint(self, **k):
        return {"remembered": True}

    def get_plan(self, **k):
        return {}


def test_propose_threads_constraints_into_options():
    api = CaptureApi()
    nodes = AgentNodes(api=api, brain=StubBrain())
    state = {
        "thread_id": "t_crew",
        "context": {
            "groupId": "g_crew",
            "organizerId": "u_alex",
            "members": [
                {"name": "Alex", "userId": "u_alex"},
                {"name": "Sam", "userId": "u_sam", "constraints": [{"text": "gluten-free", "kind": "dietary"}]},
                {
                    "name": "Jordan",
                    "isNonUser": True,
                    "contactId": "c_jordan",
                    "constraints": [
                        {"text": "broke this month", "kind": "budget", "expiresAt": "2026-07-01T00:00:00+00:00"}
                    ],
                },
            ],
        },
        "availability": {
            "windowFrom": "2026-06-05T18:00:00+00:00",
            "suggestions": [
                {"startsAt": "2026-06-05T19:30:00+00:00", "endsAt": "2026-06-05T21:00:00+00:00", "freeCount": 3}
            ],
        },
        "places": [
            {"name": "Lucia Trattoria", "tags": ["italian", "fancy"], "priceTier": 4},
            {"name": "Ananda Thai", "tags": ["thai", "dinner"], "priceTier": 2},
        ],
        "activity": "dinner",
        "intent": {"time_hint": "friday night"},
    }

    out = nodes.propose_decision(state)
    assert out["plan_id"] == "p_test"
    assert "Jordan" in out["invited"]  # non-user got a vote link

    combos = [o for o in api.proposed["options"] if o["kind"] == "COMBO"]
    assert combos and all(o.get("why") for o in combos)
    # cheap, gluten-free-friendly Thai outranks the pricey trattoria
    assert "Ananda Thai" in combos[0]["place"]
    # the proposal references the group's real constraints somewhere
    all_text = " ".join(o.get("why", "") + " ".join(o.get("fitFlags", [])) for o in combos)
    assert "Sam" in all_text or "Jordan" in all_text

    # Plot also chose a decision method and wrote an intelligent card body (§A2/§A3)
    assert api.proposed["method"] in ("boost_veto", "ranked")
    assert "Ananda Thai" in api.proposed["summary"]
    assert api.proposed["summary"].startswith("✦")
