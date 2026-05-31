"""The agent's proposal voice (PRD §A2/§A3). It picks a decision method by option count and writes
a concise card body that surfaces its fit reasoning — top pick + why + any flagged caveat — so the
group sees Plot reasoning, not a generic card. Pure logic, no network."""
import os

os.environ.pop("ANTHROPIC_API_KEY", None)

from plot_agent.summary import choose_method, proposal_summary


def test_few_options_use_boost_veto():
    opts = [{"kind": "COMBO"}, {"kind": "COMBO"}, {"kind": "ACTIVITY"}]
    assert choose_method(opts) == "boost_veto"


def test_many_options_use_ranked():
    opts = [{"kind": "COMBO"}, {"kind": "COMBO"}, {"kind": "TIME"}, {"kind": "ACTIVITY"}]
    assert choose_method(opts) == "ranked"


def test_summary_leads_with_top_pick_and_why():
    opts = [
        {"kind": "COMBO", "place": "Ananda Thai", "label": "Fri 7:30p @ Ananda Thai",
         "why": "gluten-free options for Sam; cheap-ish for Jordan"},
        {"kind": "COMBO", "place": "Lucia Trattoria", "label": "Fri 7:30p @ Lucia Trattoria",
         "why": "a proper treat", "fitFlags": ["over Jordan's budget ($$$$)"]},
        {"kind": "ACTIVITY", "label": "Keep it casual"},
    ]
    s = proposal_summary("dinner", "friday night", opts)
    assert "Ananda Thai" in s
    assert "gluten-free options for Sam" in s
    # surfaces the caveat on the flagged option
    assert "Jordan" in s and "budget" in s
    # mentions how to vote (method-aware) and that Plot will lock it
    assert "lock" in s.lower()


def test_summary_handles_no_constraints_gracefully():
    opts = [
        {"kind": "COMBO", "place": "Joe's Pizza", "label": "Sat 8p @ Joe's Pizza", "why": "casual & easy"},
        {"kind": "ACTIVITY", "label": "Keep it casual"},
    ]
    s = proposal_summary("hang", None, opts)
    assert "Joe's Pizza" in s
    assert s.startswith("✦")
