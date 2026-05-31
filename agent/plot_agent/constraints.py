"""Constraint memory + fit rationale (PRD §A2 "why it fits this group" / §A7 constraint memory).

Plot remembers per-member, per-group constraints — dietary needs, dislikes, and budget limits —
and uses them to (a) attach a *fit rationale* to each option that references at least one real
constraint, (b) *flag* poor fits with a stated reason, and (c) silently *veto* hard violations
(e.g. a disliked cuisine) when alternatives exist. Constraints can be temporary and expire.

This module is pure (no network), so the intelligence is unit-tested offline. Member constraints
ride in on the thread context payload as `member["constraints"] = [{text, kind, expiresAt?}]`."""
from __future__ import annotations
import re
from dataclasses import dataclass
from datetime import datetime, timezone


# kinds Plot understands; anything else is treated as a soft "other" preference.
DIETARY = "dietary"
DISLIKE = "dislike"
BUDGET = "budget"
OTHER = "other"

# cuisines/venues that tend to be gluten-heavy vs. easy to eat gluten-free / veg at.
_GF_HARD = ("pizza", "pasta", "italian", "trattoria", "noodle", "ramen", "bakery", "burger", "sandwich")
_VEG_FRIENDLY = ("thai", "salad", "bowl", "mexican", "poke", "veg", "vegan", "vegetarian", "mediterranean", "indian")
_MEAT_HEAVY = ("steak", "bbq", "grill", "burger", "smokehouse", "chophouse")


@dataclass
class MemberConstraint:
    member: str  # display name, so rationales can say "for Sam"
    text: str  # raw, human text e.g. "gluten-free", "broke this month"
    kind: str  # DIETARY | DISLIKE | BUDGET | OTHER
    expires_at: str | None = None


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def active_constraints(members: list[dict], now: datetime | None = None) -> list[MemberConstraint]:
    """Flatten every member's constraints into one list, dropping any that have expired.

    A temporary constraint ("broke *this month*") carries an `expiresAt`; once past, Plot forgets
    it so nobody re-litigates a stale limit."""
    now = now or datetime.now(timezone.utc)
    out: list[MemberConstraint] = []
    for m in members:
        for c in m.get("constraints") or []:
            exp = c.get("expiresAt")
            if exp:
                try:
                    if _parse(exp) <= now:
                        continue  # expired → forgotten
                except Exception:
                    pass  # unparseable expiry → treat as permanent
            out.append(
                MemberConstraint(
                    member=m.get("name", "?"),
                    text=(c.get("text") or "").strip(),
                    kind=c.get("kind") or OTHER,
                )
            )
            out[-1].expires_at = exp
    return out


def _disliked_term(text: str) -> str:
    """Extract the thing being disliked from free text, e.g. 'hates sushi' → 'sushi'."""
    t = text.lower()
    for lead in ("hates ", "dislikes ", "no ", "not into ", "can't stand "):
        if t.startswith(lead):
            return t[len(lead):].strip()
    return t.strip()


_VIBE = [
    (("rooftop", "view", "outdoor", "patio"), "rooftop with a view"),
    (("casual", "pizza"), "casual & easy"),
    (("cocktail", "bar", "drinks"), "good cocktails"),
    (("fancy",), "a proper treat"),
    (("thai", "italian", "dinner", "mexican", "indian"), "solid for a group dinner"),
]


def _vibe(tags: list[str]) -> str:
    blob = " ".join(tags)
    for keys, phrase in _VIBE:
        if any(k in blob for k in keys):
            return phrase
    return "an easy pick for the group"


def evaluate_place(place: dict, constraints: list[MemberConstraint]) -> dict:
    """Score a place against the group's active constraints.

    Returns `{why, flags, fit, veto}`:
      - `why`   : a "why it fits this group" line referencing >=1 constraint when any apply,
                  else a tag-derived vibe line.
      - `flags` : human reasons this option is a poor fit (over budget, limited GF, disliked).
      - `fit`   : integer score for ranking (higher = better; negative = poor fit).
      - `veto`  : True when a member hard-dislikes this place → candidate for silent filtering.
    """
    name = (place.get("name") or "").lower()
    tags = [str(t).lower() for t in (place.get("tags") or [])]
    tier = int(place.get("priceTier") or 2)
    blob = f"{name} {' '.join(tags)}"

    positives: list[str] = []
    flags: list[str] = []
    fit = 0
    veto = False

    for c in constraints:
        t = c.text.lower()
        if c.kind == BUDGET:
            if tier >= 3:
                flags.append(f"over {c.member}'s budget ({'$' * tier})")
                fit -= 2
            else:
                positives.append(f"cheap-ish for {c.member}")
                fit += 1
        elif c.kind == DIETARY:
            if "gluten" in t and any(k in blob for k in _GF_HARD):
                flags.append(f"limited gluten-free options for {c.member}")
                fit -= 2
            elif ("veg" in t) and any(k in blob for k in _MEAT_HEAVY):
                flags.append(f"few {c.text} options for {c.member}")
                fit -= 1
            elif any(k in blob for k in _VEG_FRIENDLY):
                positives.append(f"{c.text} options for {c.member}")
                fit += 1
        elif c.kind == DISLIKE:
            term = _disliked_term(t)
            if term and (term in blob or any(term in tag for tag in tags)):
                flags.append(f"{c.member} dislikes {term}")
                fit -= 3
                veto = True
        else:  # OTHER → soft positive when the place obviously matches the phrase
            word = t.split()[-1] if t else ""
            if word and word in blob:
                positives.append(f"matches {c.member}'s {c.text}")
                fit += 1

    why = "; ".join(dict.fromkeys(positives)) if positives else _vibe(tags)
    return {"why": why, "flags": flags, "fit": fit, "veto": veto}


# ── adaptive capture: learn a constraint a member states in chat (§A7) ──
# Conservative on purpose (first-person, declarative) so banter and questions aren't captured.

_DIETARY = re.compile(
    r"\bi(?:'m| am)\s+(vegetarian|vegan|pescatarian|gluten[- ]?free|dairy[- ]?free|lactose[- ]?intolerant)\b",
    re.I,
)
_DIETARY_CANT_EAT = re.compile(r"\bi\s+can(?:'t|not| not)\s+eat\s+([a-z][a-z ]*?)(?:[.,!]|$)", re.I)
_ALLERGIC = re.compile(r"\bi(?:'m| am)\s+allergic to\s+([a-z][a-z ]*?)(?:[.,!]|$)", re.I)
_BUDGET = re.compile(
    r"\bi(?:'m| am)\s+(broke|skint|low on (?:cash|money)|on a budget|tight on (?:cash|money)|strapped)\b",
    re.I,
)
_DISLIKE = re.compile(
    r"\bi\s+(?:hate|can(?:'t|not| not) stand|don'?t like|'m not into|am not into)\s+([a-z][a-z]*)\b",
    re.I,
)


def _end_of_period(now: datetime, body: str) -> str | None:
    """A temporary constraint ('this month/week') gets an expiry so Plot forgets it later."""
    b = body.lower()
    if "this week" in b:
        return (now.replace(hour=0, minute=0, second=0, microsecond=0) + _days(7)).isoformat()
    if "this month" in b:
        y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
        return datetime(y, m, 1, tzinfo=timezone.utc).isoformat()
    return None


def _days(n: int):
    from datetime import timedelta

    return timedelta(days=n)


def detect_stated_constraint(body: str, author: str, now: datetime | None = None) -> MemberConstraint | None:
    """Return a MemberConstraint if `author`'s message clearly states a personal constraint, else None.

    Only first-person declaratives are captured (not questions, not statements about others)."""
    now = now or datetime.now(timezone.utc)
    if "?" in body:
        return None  # a question is not a declaration

    m = _DIETARY.search(body)
    if m:
        text = m.group(1).lower().replace(" ", "-")
        return MemberConstraint(member=author, text=text, kind=DIETARY)

    m = _DIETARY_CANT_EAT.search(body) or _ALLERGIC.search(body)
    if m:
        return MemberConstraint(member=author, text=f"no {m.group(1).strip().lower()}", kind=DIETARY)

    m = _BUDGET.search(body)
    if m:
        exp = _end_of_period(now, body)
        text = f"{m.group(1).lower()} this month" if exp and "month" in body.lower() else m.group(1).lower()
        c = MemberConstraint(member=author, text=text, kind=BUDGET)
        c.expires_at = exp
        return c

    m = _DISLIKE.search(body)
    if m:
        return MemberConstraint(member=author, text=f"hates {m.group(1).strip().lower()}", kind=DISLIKE)

    return None
