"""Constraint memory data model (PRD §A7): flattening members' constraints and forgetting expired
ones. The reasoning over constraints lives in the brain (test_brain.py)."""
import os
from datetime import datetime, timezone

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.constraints import active_constraints, default_expiry


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
    cs = active_constraints(CREW, now=datetime(2026, 8, 1, tzinfo=timezone.utc))
    assert not any(c.kind == "budget" for c in cs)


def test_unexpired_temporary_constraint_kept():
    cs = active_constraints(CREW, now=datetime(2026, 6, 20, tzinfo=timezone.utc))
    assert any(c.kind == "budget" and c.member == "Jordan" for c in cs)


def test_default_expiry_is_first_of_next_month():
    exp = default_expiry(datetime(2026, 6, 5, tzinfo=timezone.utc))
    assert exp.startswith("2026-07-01")
    # December rolls into next year
    assert default_expiry(datetime(2026, 12, 9, tzinfo=timezone.utc)).startswith("2027-01-01")
