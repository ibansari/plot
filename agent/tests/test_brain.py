"""The LLM brain (replaces the old regex/keyword approach). The single SDK seam is mocked with an
injectable parser, so intent classification, constraint extraction, and option reasoning are all
exercised offline. With no parser AND no key, the brain returns conservative defaults — never regex."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.brain import (
    Brain, MessageAnalysis, ProposalReasoning, OptionAssessment, StatedConstraint, apply_reasoning,
)


def fake_parser(analysis=None, reasoning=None):
    def _p(system, user, output_model, max_tokens):
        if output_model is MessageAnalysis:
            return analysis
        if output_model is ProposalReasoning:
            return reasoning
        return None
    return _p


def msgs(*pairs):
    return [{"authorName": a, "body": b, "isAgent": False} for a, b in pairs]


# ── safe defaults when the LLM is unavailable (no parser, no key) ──

def test_no_key_defaults_to_stay_quiet():
    b = Brain()  # no parser, no ANTHROPIC_API_KEY
    r = b.analyze_message(msgs(("Max", "we should grab dinner friday")))
    assert r.decision == "STAY_QUIET" and "unavailable" in r.rationale


def test_no_human_messages_stays_quiet():
    assert Brain().analyze_message([{"isAgent": True, "body": "✦ hi"}]).decision == "STAY_QUIET"


# ── intent classification via the brain ──

def test_brain_returns_act_with_activity_and_time():
    analysis = MessageAnalysis(decision="ACT", activity="dinner", time_hint="friday night", rationale="clear")
    r = Brain(parser=fake_parser(analysis=analysis)).analyze_message(msgs(("Alex", "dinner friday?")))
    assert r.decision == "ACT" and r.activity == "dinner" and r.time_hint == "friday night"


def test_brain_extracts_stated_constraint():
    analysis = MessageAnalysis(
        decision="STAY_QUIET",
        constraint=StatedConstraint(text="vegetarian", kind="dietary", temporary=False),
    )
    r = Brain(parser=fake_parser(analysis=analysis)).analyze_message(msgs(("Priya", "I'm vegetarian now")))
    assert r.constraint and r.constraint.kind == "dietary" and not r.constraint.temporary


# ── option reasoning ──

def test_reason_about_options_empty_returns_none():
    assert Brain(parser=fake_parser()).reason_about_options("dinner", "fri", [], []) is None


def test_reason_about_options_passes_through_parser():
    reasoning = ProposalReasoning(
        method="ranked", summary="✦ My pick: Ananda Thai.",
        assessments=[OptionAssessment(label="A", why="gluten-free options for Sam", fit=3)],
    )
    out = Brain(parser=fake_parser(reasoning=reasoning)).reason_about_options(
        "dinner", "fri", [{"label": "A"}], [],
    )
    assert out.method == "ranked" and out.assessments[0].why.startswith("gluten-free")


# ── apply_reasoning: attach why/flags, rank by fit, drop hard vetoes ──

def test_apply_reasoning_ranks_and_drops_veto():
    options = [
        {"kind": "COMBO", "label": "Fri @ Lucia", "place": "Lucia"},
        {"kind": "COMBO", "label": "Fri @ Ananda", "place": "Ananda"},
        {"kind": "COMBO", "label": "Fri @ Sushi Bar", "place": "Sushi Bar"},
    ]
    reasoning = ProposalReasoning(
        method="ranked", summary="✦ ...",
        assessments=[
            OptionAssessment(label="Fri @ Lucia", why="a treat", flags=["over Jordan's budget"], fit=-2),
            OptionAssessment(label="Fri @ Ananda", why="gluten-free for Sam; cheap for Jordan", fit=4),
            OptionAssessment(label="Fri @ Sushi Bar", why="fresh", fit=-5, veto=True),
        ],
    )
    out = apply_reasoning(options, reasoning)
    labels = [o["label"] for o in out]
    assert labels[0] == "Fri @ Ananda"                 # best fit first
    assert "Fri @ Sushi Bar" not in labels             # hard veto dropped (alternatives remain)
    lucia = next(o for o in out if o["label"] == "Fri @ Lucia")
    assert lucia["why"] == "a treat" and lucia["fitFlags"] == ["over Jordan's budget"]
    assert "fit" not in lucia and "veto" not in lucia   # internal keys stripped


def test_apply_reasoning_none_passes_through():
    options = [{"label": "X"}]
    assert apply_reasoning(options, None) == options
