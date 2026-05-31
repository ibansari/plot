"""Intent classification — the first node's decision (ACT vs STAY_QUIET vs ASK).

With ANTHROPIC_API_KEY set, Claude makes the call via a forced tool-use (structured output).
With no key, a deterministic keyword/heuristic classifier returns the SAME shape, so the whole
slice runs offline. Both paths feed the identical graph."""
from __future__ import annotations
import json
import re
from dataclasses import dataclass, field
from . import config

DECISIONS = ("ACT", "STAY_QUIET", "ASK")

# Signals that the group is trying to make a plan.
_PLANNING = re.compile(
    r"\b(let'?s|should we|wanna|want to|we could|plan|hang(\s?out)?|get togeth|grab|meet up|catch up|"
    r"dinner|lunch|brunch|drinks|coffee|movie|party|trip|game night|hike)\b",
    re.I,
)
# A concrete time hint => enough to ACT rather than ASK.
_TIME = re.compile(
    r"\b(today|tonight|tomorrow|this (week|weekend|sat|sun|fri)|next (week|weekend)|"
    r"mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{1,2}\s?(am|pm)|weekend|evening|afternoon|morning)\b",
    re.I,
)
# Pure banter markers (used to bias toward STAY_QUIET).
_BANTER = re.compile(r"\b(lol|lmao|haha|omg|slander|🤣|😂|gg|nice|congrats|owes? me)\b", re.I)


@dataclass
class IntentResult:
    decision: str  # one of DECISIONS
    activity: str | None = None  # e.g. "dinner", "drinks"
    time_hint: str | None = None  # e.g. "friday night"
    question: str | None = None  # the ASK text, when decision == ASK
    rationale: str = ""
    raw: dict = field(default_factory=dict)


def _heuristic(latest: str) -> IntentResult:
    text = latest.strip()
    planning = bool(_PLANNING.search(text))
    has_time = bool(_TIME.search(text))
    banter = bool(_BANTER.search(text))

    if not planning:
        return IntentResult("STAY_QUIET", rationale="no planning signal")

    # planning signal present
    activity_m = re.search(r"\b(dinner|lunch|brunch|drinks|coffee|movie|party|hike|game night)\b", text, re.I)
    activity = activity_m.group(0).lower() if activity_m else None

    if has_time and activity:
        return IntentResult("ACT", activity=activity, time_hint=_TIME.search(text).group(0).lower(),
                            rationale="clear intent: activity + time")
    if has_time and not activity:
        return IntentResult("ACT", time_hint=_TIME.search(text).group(0).lower(),
                            rationale="time given; default activity")
    if banter and not has_time:
        return IntentResult("STAY_QUIET", rationale="planning word but banter context")
    # planning intent but under-specified → ask ONE question
    q = "Love it — when are you all thinking, and roughly what kind of thing (dinner, drinks, something else)?"
    return IntentResult("ASK", activity=activity, question=q, rationale="planning but missing time")


def classify_intent(messages: list[dict]) -> IntentResult:
    """messages: [{authorName, body, isAgent}] oldest→newest. Returns IntentResult."""
    human = [m for m in messages if not m.get("isAgent")]
    if not human:
        return IntentResult("STAY_QUIET", rationale="no human messages")
    latest = human[-1]["body"]

    if not config.ANTHROPIC_API_KEY:
        return _heuristic(latest)

    # ── Claude path: forced tool-use for structured classification ──
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        transcript = "\n".join(f"{m.get('authorName','?')}: {m['body']}" for m in messages[-12:])
        tool = {
            "name": "classify",
            "description": "Decide whether Plot should act, stay quiet, or ask one clarifying question.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "decision": {"type": "string", "enum": list(DECISIONS)},
                    "activity": {"type": "string"},
                    "time_hint": {"type": "string"},
                    "question": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["decision", "rationale"],
            },
        }
        msg = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=400,
            system=(
                "You are Plot, a planning agent inside a friends' group chat. You DEFAULT TO SILENCE. "
                "Only ACT when the group is clearly trying to make a concrete plan (activity + a time "
                "window are inferable). ASK exactly one short question when intent is present but "
                "under-specified. Otherwise STAY_QUIET. Never act on banter."
            ),
            tools=[tool],
            tool_choice={"type": "tool", "name": "classify"},
            messages=[{"role": "user", "content": f"Recent chat:\n{transcript}\n\nClassify the latest human message."}],
        )
        block = next(b for b in msg.content if getattr(b, "type", None) == "tool_use")
        data = block.input
        return IntentResult(
            decision=data["decision"] if data.get("decision") in DECISIONS else "STAY_QUIET",
            activity=data.get("activity"),
            time_hint=data.get("time_hint"),
            question=data.get("question"),
            rationale=data.get("rationale", ""),
            raw=data if isinstance(data, dict) else json.loads(json.dumps(data, default=str)),
        )
    except Exception as e:  # graceful: on any LLM error, fall back to heuristic
        res = _heuristic(latest)
        res.rationale = f"fallback ({e.__class__.__name__}): {res.rationale}"
        return res
