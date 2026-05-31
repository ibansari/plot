"""Constraint memory + fit rationale (PRD §A2/§A7). Pure logic, no network.

Plot knows per-member constraints (Sam gluten-free, Max hates sushi, Jordan broke this month),
drops expired ones, attaches a "why it fits this group" line to each option that references at
least one constraint, flags poor fits with a reason, and silently filters hard vetoes."""
import os
from datetime import datetime, timezone

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.constraints import active_constraints, evaluate_place, MemberConstraint
from plot_agent.tools import build_decision_options


CREW = [
    {"name": "Alex"},
    {"name": "Sam", "constraints": [{"text": "gluten-free", "kind": "dietary"}]},
    {"name": "Max", "constraints": [{"text": "hates sushi", "kind": "dislike"}]},
    {
        "name": "Jordan",
        "constraints": [{"text": "broke this month", "kind": "budget", "expiresAt": "2026-07-01T00:00:00+00:00"}],
    },
]


def test_active_constraints_flattens_members():
    cs = active_constraints(CREW, now=datetime(2026, 6, 5, tzinfo=timezone.utc))
    kinds = {c.kind for c in cs}
    assert {"dietary", "dislike", "budget"} <= kinds
    assert any(c.member == "Sam" and "gluten" in c.text for c in cs)


def test_expired_constraints_are_dropped():
    # after the expiry date, "broke this month" no longer applies
    cs = active_constraints(CREW, now=datetime(2026, 8, 1, tzinfo=timezone.utc))
    assert not any(c.kind == "budget" for c in cs)


def test_budget_constraint_flags_pricey_place():
    cs = active_constraints(CREW, now=datetime(2026, 6, 5, tzinfo=timezone.utc))
    pricey = {"name": "Lucia Trattoria", "tags": ["italian", "fancy", "dinner"], "priceTier": 4}
    res = evaluate_place(pricey, cs)
    # over Jordan's budget AND limited gluten-free → two flags, negative fit
    assert any("Jordan" in f for f in res["flags"])
    assert any("Sam" in f for f in res["flags"])
    assert res["fit"] < 0


def test_cheap_gf_friendly_place_gets_positive_why():
    cs = active_constraints(CREW, now=datetime(2026, 6, 5, tzinfo=timezone.utc))
    thai = {"name": "Ananda Thai", "tags": ["thai", "dinner"], "priceTier": 2}
    res = evaluate_place(thai, cs)
    assert res["fit"] > 0
    # the why references a real constraint by member name
    assert "Sam" in res["why"] or "Jordan" in res["why"]
    assert res["flags"] == []


def test_dislike_is_a_hard_veto_flag():
    max_only = [MemberConstraint(member="Max", text="hates sushi", kind="dislike")]
    sushi = {"name": "Sushi Nakata", "tags": ["sushi", "japanese"], "priceTier": 3}
    res = evaluate_place(sushi, max_only)
    assert any("Max" in f and "sushi" in f for f in res["flags"])
    assert res["fit"] <= -3


def test_options_carry_why_and_flags_and_are_constraint_sorted():
    cs = active_constraints(CREW, now=datetime(2026, 6, 5, tzinfo=timezone.utc))
    availability = {
        "windowFrom": "2026-06-05T18:00:00+00:00",
        "suggestions": [
            {"startsAt": "2026-06-05T19:30:00+00:00", "endsAt": "2026-06-05T21:00:00+00:00", "freeCount": 4},
        ],
    }
    places = [
        {"name": "Lucia Trattoria", "tags": ["italian", "fancy"], "priceTier": 4},  # poor fit
        {"name": "Ananda Thai", "tags": ["thai", "dinner"], "priceTier": 2},        # good fit
    ]
    opts = build_decision_options(availability, places, "dinner", constraints=cs)
    combos = [o for o in opts if o["kind"] == "COMBO"]
    assert combos, "expected COMBO options"
    # every combo carries a why line
    assert all(o.get("why") for o in combos)
    # the better-fitting place is ranked first
    assert "Ananda Thai" in combos[0]["place"]
    # the pricey one is flagged
    pricey = next((o for o in combos if "Lucia" in o["place"]), None)
    if pricey:
        assert pricey.get("fitFlags")
