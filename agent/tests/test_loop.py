"""The agentic loop (Claude drives via tool use). A scripted fake loop-caller returns tool_use blocks
then ends — so the whole loop runs offline with no key and no network. Verifies: a sushi turn
proposes via the chosen tools and invites non-users; the loop stays silent when Claude finishes with
nothing; the per-turn step cap halts a runaway; and with no LLM it falls back to the deterministic
propose path (never un-gated)."""
import os
from types import SimpleNamespace

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["PLOT_DEMO_NOW_ISO"] = "2026-06-05T18:00:00.000Z"

from plot_agent.nodes import AgentNodes
from plot_agent.brain import Brain


# ── helpers to script Claude tool-use responses ──
def tu(name, **inp):
    return SimpleNamespace(type="tool_use", id="tu_" + name, name=name, input=inp)


def resp(blocks, stop="tool_use"):
    return SimpleNamespace(content=blocks, stop_reason=stop)


class ScriptedCaller:
    def __init__(self, scripts):
        self.scripts = scripts
        self.i = 0
        self.calls = []

    def __call__(self, system, messages, tools):
        self.calls.append([t["name"] for t in tools])
        r = self.scripts[min(self.i, len(self.scripts) - 1)]
        self.i += 1
        return r


class LoopApi:
    def __init__(self):
        self.proposed = None
        self.messages = []
        self.invited = []

    def context(self, thread_id):
        return CTX

    def propose(self, payload):
        self.proposed = payload
        return {"id": "p_loop", "state": "VOTING", "options": payload["options"]}

    def gather_availability(self, **k):
        return {"windowFrom": "2026-06-05T18:00:00+00:00", "suggestions": [
            {"startsAt": "2026-06-05T19:00:00+00:00", "endsAt": "2026-06-05T20:30:00+00:00", "freeCount": 4}]}

    def research_places(self, **k):
        return [{"name": "Sushi Nakazawa", "priceTier": 3, "address": "23 Commerce St", "tags": ["sushi"]}]

    def invite_non_user(self, plan_id, contact_id, purpose="vote"):
        self.invited.append(contact_id)
        return {"ok": True}

    def post_agent_message(self, thread_id, body, kind="AGENT", plan_id=None):
        self.messages.append(body)
        return {"id": "m"}

    def get_plan(self, **k):
        return {"state": "VOTING", "options": [], "votes": []}

    def lock(self, **k):
        return {}

    def create_split(self, **k):
        return {"created": True, "split": {"perHeadCents": 0}}

    def remember_constraint(self, **k):
        return {"remembered": True}


CTX = {
    "groupId": "g_crew", "organizerId": "u_alex",
    "members": [
        {"name": "Alex", "userId": "u_alex"},
        {"name": "Jordan", "isNonUser": True, "contactId": "c_jordan"},
    ],
    "messages": [{"authorName": "Alex", "body": "let's go out for sushi tonight", "isAgent": False}],
}


def _state(intent_decision="ACT"):
    return {"thread_id": "t_crew", "trigger": "message", "context": CTX,
            "intent": {"decision": intent_decision, "activity": "sushi", "time_hint": "tonight"}}


def test_sushi_turn_proposes_and_invites():
    api = LoopApi()
    brain = Brain(loop_caller=ScriptedCaller([
        resp([tu("research_places", query="sushi", near="downtown")]),
        resp([tu("propose_plan", title="Sushi tonight", method="boost_veto",
                 summary="✦ Sushi Nakazawa at 7 is my pick.",
                 options=[
                     {"kind": "COMBO", "label": "7PM @ Sushi Nakazawa", "place": "Sushi Nakazawa", "priceTier": 3, "why": "great sushi"},
                     {"kind": "ACTIVITY", "label": "Keep it casual"},
                 ])]),
        resp([tu("finish_turn", reason="proposed")]),
    ]))
    out = AgentNodes(api=api, brain=brain).agent_loop(_state())
    assert out["result"] == "PROPOSED" and out["plan_id"] == "p_loop"
    assert api.proposed and len(api.proposed["options"]) == 2
    assert api.proposed["summary"].startswith("✦")
    assert "c_jordan" in api.invited  # non-user auto-invited after propose


def test_loop_stays_silent_when_claude_finishes_with_nothing():
    api = LoopApi()
    brain = Brain(loop_caller=ScriptedCaller([resp([tu("finish_turn", reason="banter")])]))
    out = AgentNodes(api=api, brain=brain).agent_loop(_state())
    assert api.proposed is None and api.messages == []
    assert out["result"] == "NOOP"


def test_step_cap_halts_runaway():
    api = LoopApi()
    # always asks for more research, never finishes
    brain = Brain(loop_caller=ScriptedCaller([resp([tu("research_places", query="x")])]))
    out = AgentNodes(api=api, brain=brain).agent_loop(_state())
    from plot_agent.loop import MAX_STEPS
    assert brain._loop_caller.i == MAX_STEPS  # capped, didn't loop forever
    assert api.proposed is None


def test_no_llm_falls_back_to_deterministic_propose():
    api = LoopApi()
    brain = Brain()  # no loop_caller, no key → run_loop_step returns None
    out = AgentNodes(api=api, brain=brain).agent_loop(_state())
    # deterministic gather → research → propose still produces a plan, fully gated
    assert api.proposed is not None
    assert len(api.proposed["options"]) >= 2
