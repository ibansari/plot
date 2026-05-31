"""Constraint memory (PRD §A7) — the data model + expiry handling.

Plot remembers per-member, per-group constraints (dietary needs, dislikes, temporary budget limits)
and applies them when proposing. The *reasoning* over constraints — which option fits whom and why,
what to flag, what to veto — is done by the LLM brain (see brain.reason_about_options); the
*detection* of a newly-stated constraint is also the brain's job (brain.analyze_message). This module
only holds the shared shape and the deterministic expiry logic (no LLM, no regex).

Member constraints ride in on the thread context payload as
`member["constraints"] = [{text, kind, expiresAt?}]`."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


# kinds Plot understands; anything else is treated as a soft "other" preference.
DIETARY = "dietary"
DISLIKE = "dislike"
BUDGET = "budget"
OTHER = "other"


@dataclass
class MemberConstraint:
    member: str  # display name, so rationales can say "for Sam"
    text: str  # canonical text e.g. "gluten-free", "hates sushi", "broke this month"
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
                    expires_at=exp,
                )
            )
    return out


def default_expiry(now: datetime | None = None) -> str:
    """Expiry for a constraint the brain flagged as temporary: the first of next month (UTC).
    A "broke this month" limit shouldn't outlive the month."""
    now = now or datetime.now(timezone.utc)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(y, m, 1, tzinfo=timezone.utc).isoformat()
