"""How Plot *talks* when it proposes (PRD §A2 fit rationale in the thread, §A3 decision method).

`choose_method` picks the lightest decision tool that fits the option count, and `proposal_summary`
writes the decision-card body: it leads with the best-fitting option and *why* it fits this group,
notes one caveat on a flagged option, and tells people how to vote + that Plot will lock the leader
at the soft deadline. Pure (no network), so the agent's voice is unit-tested offline."""
from __future__ import annotations


# Plot picks the lightest tool that fits: few options → boost-one/veto-one; more → ranked-choice
# (PRD §A3). Swipe/bracket are reserved for the long-tail and not used in the slice.
def choose_method(options: list[dict]) -> str:
    votable = [o for o in options if o.get("kind") in ("COMBO", "PLACE", "TIME", "ACTIVITY")]
    return "boost_veto" if len(votable) <= 3 else "ranked"


def _how_to_vote(method: str) -> str:
    if method == "ranked":
        return "Rank them and I'll lock the leader at the deadline."
    return "Boost the one you want (veto a dealbreaker) and I'll lock the leader at the deadline."


def proposal_summary(activity: str | None, time_hint: str | None, options: list[dict]) -> str:
    """Compose the decision-card body. Leads with the top pick + why, surfaces one caveat."""
    combos = [o for o in options if o.get("kind") == "COMBO"]
    lead = combos[0] if combos else (options[0] if options else None)
    when = f" for {time_hint}" if time_hint else ""
    act = activity or "a hang"

    parts = [f"✦ Found a couple of {act} options{when}."]
    if lead:
        place = lead.get("place") or lead.get("label")
        why = lead.get("why")
        parts.append(f"My pick: {place}" + (f" — {why}." if why else "."))

    # surface the first caveat from any flagged option so trade-offs are visible, not hidden
    flagged = next((o for o in combos if o.get("fitFlags")), None)
    if flagged and flagged is not lead:
        place = flagged.get("place") or flagged.get("label")
        parts.append(f"Heads up: {place} is {flagged['fitFlags'][0]}.")
    elif flagged and flagged is lead and len(flagged["fitFlags"]) > 0:
        parts.append(f"(One caveat: {flagged['fitFlags'][0]}.)")

    parts.append(_how_to_vote(choose_method(options)))
    return " ".join(parts)
