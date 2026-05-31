"""Routing fix for the suggestion loop: Plot only OFFERS ("want me to draft?") for fresh planning
intent. Replies to an open suggestion, refinements of a live plan, and questions go to the loop so
Plot drafts/answers instead of re-posting the same nudge."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.nodes import AgentNodes
from plot_agent.brain import Brain


class StubApi:
    def __getattr__(self, _n):
        return lambda *a, **k: {}


def nodes():
    return AgentNodes(api=StubApi(), brain=Brain())


def ctx(messages):
    return {"groupId": "g", "members": [], "messages": messages}


def state(decision="ACT", messages=None, trigger="message"):
    return {"thread_id": "t", "trigger": trigger, "intent": {"decision": decision},
            "context": ctx(messages or [{"authorName": "Sam", "body": "let's get dinner tonight", "isAgent": False}])}


def test_fresh_intent_offers_to_draft():
    assert nodes().route_after_remember(state("ACT")) == "suggest"


def test_banter_stays_quiet():
    assert nodes().route_after_remember(state("STAY_QUIET")) == "quiet"


def test_reply_to_open_suggestion_goes_to_loop_not_resuggest():
    msgs = [
        {"authorName": "Sam", "body": "dinner tonight", "isAgent": False},
        {"authorName": "Plot", "body": "✦ Want me to draft a few options?", "isAgent": True,
         "metadata": {"kind": "plot_suggestion", "status": "open"}},
        {"authorName": "Sam", "body": "Yes", "isAgent": False},
    ]
    assert nodes().route_after_remember(state("ACT", msgs)) == "loop"


def test_question_is_answered_not_suggested():
    msgs = [{"authorName": "Sam", "body": "what are the commute times for everyone?", "isAgent": False}]
    assert nodes().route_after_remember(state("ACT", msgs)) == "loop"


def test_live_plan_refinement_goes_to_loop():
    msgs = [
        {"kind": "DECISION_CARD", "body": "✦ Fair dinner tonight", "isAgent": True},
        {"authorName": "Sam", "body": "make it cheaper", "isAgent": False},
    ]
    assert nodes().route_after_remember(state("ACT", msgs)) == "loop"


def test_confirmed_intent_trigger_goes_to_loop():
    assert nodes().route_after_remember(state("ACT", trigger="confirmed_intent")) == "loop"


def test_suggest_plan_is_idempotent_when_one_is_open():
    msgs = [{"authorName": "Plot", "body": "✦ Want me to draft?", "isAgent": True,
             "metadata": {"kind": "plot_suggestion", "status": "open"}}]
    out = nodes().suggest_plan(state("ACT", msgs))
    assert out["result"] == "NOOP"
