"""Plot's reasoning brain — Claude does the thinking that used to be hand-rolled regex/keywords.

One module owns every LLM call. It uses the Anthropic SDK (`claude-opus-4-8`) with structured
outputs (`messages.parse` + Pydantic), so each call returns a validated object — no string parsing.
The stable persona system prompt carries a `cache_control` breakpoint for prompt caching.

Two reasoning surfaces:
  • analyze_message  — intent (ACT/ASK/STAY_QUIET) + any personal constraint the speaker just stated.
  • reason_about_options — per-option "why it fits this group" + poor-fit flags + a hard-veto signal,
                           plus the decision method and the natural-language decision-card body.

Testability: the SDK call is isolated behind an injectable `parser`. Unit tests pass a fake parser
that returns canned Pydantic models, so the whole agent is exercised offline with no key and no
network. When no key is configured (or the API errors), the brain returns conservative defaults —
Plot stays quiet, remembers nothing, flags nothing — never the old regex."""
from __future__ import annotations

import logging
from typing import Callable, List, Literal, Optional

from pydantic import BaseModel, Field

from . import config

log = logging.getLogger("plot-agent.brain")

CONSTRAINT_KINDS = ("dietary", "dislike", "budget", "other")


# ── structured-output schemas (validated by messages.parse) ──

class StatedConstraint(BaseModel):
    """A personal constraint the latest speaker stated about THEMSELVES."""
    text: str = Field(description="short canonical phrasing, e.g. 'gluten-free', 'hates sushi', 'broke this month'")
    kind: Literal["dietary", "dislike", "budget", "other"]
    temporary: bool = Field(description="true if scoped to a window like 'this week/month' and should expire")


class MessageAnalysis(BaseModel):
    decision: Literal["ACT", "STAY_QUIET", "ASK"]
    activity: Optional[str] = Field(default=None, description="e.g. 'dinner', 'drinks', 'games night'")
    time_hint: Optional[str] = Field(default=None, description="e.g. 'friday night', 'this weekend'")
    question: Optional[str] = Field(default=None, description="the ONE clarifying question, only when decision is ASK")
    rationale: str = ""
    constraint: Optional[StatedConstraint] = Field(
        default=None,
        description="set only if the latest speaker made a first-person, declarative statement about their own constraint",
    )


class OptionAssessment(BaseModel):
    label: str = Field(description="echo the option's label verbatim so it can be matched back")
    why: str = Field(description="one short 'why it fits this group' line; reference a constraint by member name when one applies")
    flags: List[str] = Field(default_factory=list, description="poor-fit reasons naming the member, e.g. \"over Jordan's budget\"")
    fit: int = Field(description="ranking score; higher is better, negative means a poor fit")
    veto: bool = Field(default=False, description="true only if a member would hard-refuse this option")


class ProposalReasoning(BaseModel):
    method: Literal["boost_veto", "ranked"]
    summary: str = Field(description="the decision-card body; starts with the ✦ sigil, leads with the top pick + why, surfaces one caveat, says how to vote and that Plot locks the leader at the deadline")
    assessments: List[OptionAssessment]


_ANALYZE_SYSTEM = (
    "You are Plot, an AI member of a close friends' group chat. Your job is to quietly turn "
    "conversation into concrete plans. You DEFAULT TO SILENCE and earn your turns — you speak only "
    "when you add resolution, never on banter.\n\n"
    "Analyze the LATEST human message in the context of the recent thread and decide ONE of:\n"
    "• ACT — the group is trying to make OR refine a plan, OR is asking Plot a planning-relevant "
    "question (a venue/activity idea, timing, travel time or feasibility like 'how long is the drive' "
    "or 'is a day trip doable', budget, 'where should we…', refining a live option). Plot should help "
    "— it has tools (availability, maps, places). Fill in activity/time_hint when inferable.\n"
    "• ASK — planning intent but too underspecified to help yet. Provide ONE short, warm question.\n"
    "• STAY_QUIET — ONLY pure social banter/jokes with no request to Plot and no planning signal, or "
    "logistics already fully settled. When in doubt between STAY_QUIET and ACT, prefer ACT — the loop "
    "can still choose to stay silent.\n\n"
    "Separately, detect whether the latest speaker stated a PERSONAL constraint about themselves — a "
    "dietary need ('I'm vegetarian'), a dislike ('I can't do sushi'), or a temporary budget limit "
    "('I'm broke this month'). Capture it ONLY when it is first-person and declarative — never from a "
    "question, and never a statement about someone else. Mark it temporary when scoped to a window "
    "like 'this week' or 'this month'. If no such statement, leave constraint null."
)

_LOOP_SYSTEM = (
    "You are Plot, an AI member of a close friends' group chat that quietly turns conversation into "
    "concrete plans. You act by CALLING TOOLS — you have tools to check the group's free/busy time, "
    "search real venues and activities, propose a votable decision, read a plan's state, and speak in "
    "the thread. Any text you write outside a tool call is private scratch and is NEVER shown to the "
    "group — the only way to say something is the post_message tool.\n\n"
    "PRINCIPLES:\n"
    "• Default to silence and earn your turn. If the latest messages are banter, jokes, or already-"
    "settled logistics, call finish_turn immediately with no message.\n"
    "• Be conversation-aware. Read the whole thread and the group's known constraints, and act on what "
    "they actually need right now — answer a question, refine a live option, or propose something new.\n"
    "• Match effort to the ask. 'sushi tonight' → one quick research + propose. A trip or an open "
    "question → gather availability, research a few options, and either ask ONE clarifying question or "
    "propose. Don't over-call tools; stop when you've added resolution.\n"
    "• Respect the group: every proposal's options should fit known constraints (diet, dislikes, "
    "budget) — say why each option fits, and flag poor fits rather than hiding them.\n"
    "• You propose; people decide. Locking, spending, and booking happen elsewhere with human/limit "
    "gates — if a tool comes back 'blocked: needs approval', post a short message asking, then finish.\n"
    "• When you're done (including when the right move was to stay quiet), call finish_turn."
)

_REASON_SYSTEM = (
    "You are Plot, proposing a plan inside a friends' group chat. You are given the activity, a time "
    "hint, the group's known constraints (per member), and a list of candidate options.\n\n"
    "For EACH option, write a concise 'why it fits this group' line — reference a relevant constraint "
    "by the member's name when one applies (e.g. 'gluten-free options for Sam; cheap-ish for Jordan'). "
    "List poor-fit flags that name the member and the reason (e.g. \"over Jordan's budget\"). Give an "
    "integer fit score (higher is better; negative for a poor fit). Set veto=true only if a member "
    "would hard-refuse the option (e.g. a cuisine they said they hate).\n\n"
    "Then choose a decision method: 'boost_veto' when there are 3 or fewer options, otherwise "
    "'ranked'. Finally write the decision-card body: start with the ✦ sigil, lead with your top pick "
    "and why it fits, surface ONE caveat from a flagged option, and end by telling people how to vote "
    "and that you'll lock the leader at the soft deadline. Keep it to 2–3 short sentences."
)


# parser signature: (system, user, output_model, max_tokens) -> BaseModel | None
Parser = Callable[..., Optional[BaseModel]]


class Brain:
    def __init__(self, parser: Parser | None = None, model: str | None = None, loop_caller=None):
        self.model = model or config.ANTHROPIC_MODEL
        self._parser = parser  # injected in tests; None → real SDK
        self._loop_caller = loop_caller  # injected in tests; takes (system, messages, tools) → response

    # ── agentic-loop SDK seam: one Claude tool-use step (client.messages.create with tools). The
    # loop in loop.py owns iteration + dispatch through the SAME ToolRegistry gate. Returns the
    # response (content blocks + stop_reason) or None when the LLM is unavailable. ──
    def run_loop_step(self, system: str, messages: list[dict], tools: list[dict]):
        if self._loop_caller is not None:
            return self._loop_caller(system=system, messages=messages, tools=tools)
        if not config.ANTHROPIC_API_KEY:
            return None
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
            return client.messages.create(
                model=self.model,
                max_tokens=2048,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                tools=tools,
            )
        except Exception as e:
            log.warning("brain loop step failed (%s) — falling back", e.__class__.__name__)
            return None

    # ── the single SDK seam ──
    def _run(self, system: str, user: str, model_cls, max_tokens: int = 800):
        if self._parser is not None:
            return self._parser(system=system, user=user, output_model=model_cls, max_tokens=max_tokens)
        if not config.ANTHROPIC_API_KEY:
            return None  # no key → caller uses a safe default
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
            resp = client.messages.parse(
                model=self.model,
                max_tokens=max_tokens,
                # stable persona prompt carries the cache breakpoint (caches once large enough)
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_format=model_cls,
            )
            return resp.parsed_output
        except Exception as e:  # never crash the turn on an LLM error
            log.warning("brain LLM call failed (%s) — using safe default", e.__class__.__name__)
            return None

    # ── intent + constraint extraction (replaces the old regex classifier) ──
    def analyze_message(self, messages: list[dict]) -> MessageAnalysis:
        human = [m for m in messages if not m.get("isAgent")]
        if not human:
            return MessageAnalysis(decision="STAY_QUIET", rationale="no human messages")
        transcript = "\n".join(f"{m.get('authorName', '?')}: {m['body']}" for m in messages[-12:])
        author = human[-1].get("authorName", "?")
        user = (
            f"Recent chat:\n{transcript}\n\n"
            f"The latest human message is from {author}. Decide the action and extract any personal "
            f"constraint {author} stated about themselves."
        )
        result = self._run(_ANALYZE_SYSTEM, user, MessageAnalysis, max_tokens=600)
        if result is None:
            return MessageAnalysis(decision="STAY_QUIET", rationale="llm-unavailable")
        return result

    # ── option reasoning: why/flags/fit + method + card body (replaces keyword fit logic) ──
    def reason_about_options(
        self, activity: str | None, time_hint: str | None, options: list[dict], constraints: list,
    ) -> ProposalReasoning | None:
        if not options:
            return None
        constraint_lines = (
            "\n".join(f"- {c.member}: {c.text} ({c.kind})" for c in constraints) or "- (none on record)"
        )
        option_lines = "\n".join(
            f"- {o.get('label')}"
            + (f" · place: {o['place']}" if o.get("place") else "")
            + (f" · price: {'$' * int(o['priceTier'])}" if o.get("priceTier") else "")
            for o in options
        )
        user = (
            f"Activity: {activity or 'a hang'}\n"
            f"Time: {time_hint or 'soon'}\n\n"
            f"Group constraints:\n{constraint_lines}\n\n"
            f"Candidate options:\n{option_lines}\n\n"
            f"Assess every option and write the decision-card body."
        )
        return self._run(_REASON_SYSTEM, user, ProposalReasoning, max_tokens=900)


def apply_reasoning(options: list[dict], reasoning: ProposalReasoning | None) -> list[dict]:
    """Attach the brain's why/flags to each option (matched by label), rank by fit, and silently
    drop a hard-vetoed option when alternatives remain (PRD §A7). Pure — unit-tested offline.
    With no reasoning (LLM unavailable) the options pass through unchanged."""
    if reasoning is None:
        return options
    by_label = {a.label: a for a in reasoning.assessments}
    enriched = []
    for o in options:
        a = by_label.get(o["label"])
        if a:
            o = {**o, "why": a.why, "fit": a.fit, "veto": a.veto}
            if a.flags:
                o["fitFlags"] = a.flags
        enriched.append(o)
    # rank by fit (options without an assessment sort to the end), drop vetoes if alternatives remain
    enriched.sort(key=lambda o: o.get("fit", -999), reverse=True)
    kept = [o for o in enriched if not o.get("veto")]
    ranked = kept if len(kept) >= 2 else enriched
    # strip internal scoring keys before they leave for the API
    for o in ranked:
        o.pop("fit", None)
        o.pop("veto", None)
    return ranked
