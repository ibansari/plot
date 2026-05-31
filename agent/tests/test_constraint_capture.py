"""Adaptive constraint memory (PRD §A7): Plot learns a constraint a member states in chat and
remembers it for next time. Detection is conservative (first person, declarative) to avoid
capturing banter. Pure logic, no network."""
import os
from datetime import datetime, timezone

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.constraints import detect_stated_constraint


def test_detects_dietary():
    c = detect_stated_constraint("honestly I'm vegetarian now", "Priya")
    assert c is not None and c.kind == "dietary" and c.member == "Priya"
    assert "vegetarian" in c.text


def test_detects_gluten_free():
    c = detect_stated_constraint("heads up I'm gluten-free these days", "Sam")
    assert c and c.kind == "dietary" and "gluten" in c.text


def test_detects_temporary_budget_with_expiry():
    now = datetime(2026, 6, 5, tzinfo=timezone.utc)
    c = detect_stated_constraint("ngl I'm broke this month", "Jordan", now=now)
    assert c and c.kind == "budget"
    assert c.expires_at is not None  # "this month" → expires
    assert c.expires_at > now.isoformat()


def test_detects_dislike():
    c = detect_stated_constraint("I can't stand sushi", "Max")
    assert c and c.kind == "dislike"
    assert "sushi" in c.text


def test_ignores_banter_and_third_person():
    assert detect_stated_constraint("lol that game was wild", "Max") is None
    assert detect_stated_constraint("Sam is gluten-free btw", "Max") is None  # not first-person
    assert detect_stated_constraint("are you vegetarian?", "Max") is None  # a question
