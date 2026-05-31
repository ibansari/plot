"""The graph's nodes. Each node is a pure-ish function of state → partial state. Side effects go
through the typed tool registry (which gates permission/cap) and the API (which audits)."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any
from .api_client import ApiClient
from .tools import ToolRegistry, ApprovalRequired, build_decision_options
from .constraints import active_constraints, detect_stated_constraint
from .summary import choose_method, proposal_summary
from .llm import classify_intent
from . import config


def _now() -> datetime:
    try:
        return datetime.fromisoformat(config.DEMO_NOW_ISO.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


class AgentNodes:
    def __init__(self, api: ApiClient | None = None):
        self.api = api or ApiClient()
        self.tools = ToolRegistry(self.api)

    # entry: always load FRESH thread context (never reuse a checkpointed snapshot, or we'd
    # classify a stale "latest message").
    def dispatch(self, state: dict) -> dict:
        return {"context": self.api.context(state["thread_id"])}

    # ── remember: silently learn a constraint the latest speaker just stated (§A7) ──
    # Runs before detect-intent on the message path; writes memory, never speaks.
    def remember(self, state: dict) -> dict:
        ctx = state["context"]
        human = [m for m in ctx.get("messages", []) if not m.get("isAgent")]
        if not human:
            return {}
        latest = human[-1]
        author = latest.get("authorName") or "?"
        c = detect_stated_constraint(latest.get("body", ""), author, now=_now())
        if not c:
            return {}
        member = next((m for m in ctx.get("members", []) if m.get("name") == author), None)
        if not member:
            return {}
        try:
            self.tools.invoke(
                "remember_constraint",
                group_id=ctx["groupId"], text=c.text, kind=c.kind,
                user_id=member.get("userId"), contact_id=member.get("contactId"),
                expires_at=c.expires_at,
            )
        except Exception:
            pass  # memory is best-effort; never block the turn on it
        return {"remembered": {"member": author, "text": c.text, "kind": c.kind}}

    # ── detect-intent: ACT vs STAY_QUIET vs ASK ──
    def detect_intent(self, state: dict) -> dict:
        ctx = state["context"]
        intent = classify_intent(ctx["messages"])
        return {"intent": {
            "decision": intent.decision, "activity": intent.activity,
            "time_hint": intent.time_hint, "question": intent.question, "rationale": intent.rationale,
        }}

    def stay_quiet(self, state: dict) -> dict:
        # silence is NOT an action: no message, no audit row (§9).
        return {"result": "STAY_QUIET", "decision": "STAY_QUIET"}

    def ask(self, state: dict) -> dict:
        q = state["intent"].get("question") or "When works, and what are you in the mood for?"
        self.tools.invoke("post_message", thread_id=state["thread_id"], body=f"✦ {q}")
        return {"result": "ASK", "decision": "ASK"}

    # ── gather-availability (busy/free) ──
    def gather_availability(self, state: dict) -> dict:
        ctx = state["context"]
        frm = _now()
        to = frm + timedelta(hours=5)
        avail = self.tools.invoke(
            "gather_availability",
            group_id=ctx["groupId"], from_iso=frm.isoformat(), to_iso=to.isoformat(),
        )
        return {"availability": avail}

    # ── research (places) ──
    def research(self, state: dict) -> dict:
        ctx = state["context"]
        activity = (state.get("intent") or {}).get("activity") or "dinner"
        organizer = ctx.get("organizerId") or next((m["userId"] for m in ctx["members"] if m.get("userId")), "")
        places = self.tools.invoke(
            "research_places", user_id=organizer, group_id=ctx["groupId"], query=activity, near=None,
        )
        return {"places": places, "activity": activity}

    # ── propose-decision: build mixed options, open voting, invite non-users ──
    def propose_decision(self, state: dict) -> dict:
        ctx = state["context"]
        # constraint memory (§A7): drop expired constraints, then let option-building apply them
        constraints = active_constraints(ctx.get("members") or [], now=_now())
        options = build_decision_options(
            state.get("availability") or {}, state.get("places") or [], state.get("activity"),
            constraints=constraints,
        )
        activity = state.get("activity") or "hang"
        time_hint = (state.get("intent") or {}).get("time_hint")
        title = f"{activity.capitalize()} — {time_hint or 'soon'}"
        # Plot's voice: pick a decision method and write a card body that shows its reasoning (§A2/§A3)
        method = choose_method(options)
        summary = proposal_summary(activity, time_hint, options)
        plan = self.tools.invoke(
            "propose_plan",
            payload={
                "threadId": state["thread_id"],
                "groupId": ctx["groupId"],
                "title": title,
                "options": options,
                "organizerId": ctx.get("organizerId"),
                "spendCapCents": config.DEFAULT_SPEND_CAP_CENTS,
                "method": method,
                "summary": summary,
            },
        )
        plan_id = plan["id"]
        # bridge to non-users: text each Contact a signed vote link
        invited = []
        for m in ctx["members"]:
            if m.get("isNonUser") and m.get("contactId"):
                self.tools.invoke("invite_non_user", plan_id=plan_id, contact_id=m["contactId"], purpose="vote")
                invited.append(m["name"])
        return {"plan_id": plan_id, "result": "PROPOSED", "decision": "ACT", "invited": invited}

    # ── act-or-ask: fired by the durable timer at the soft deadline ──
    def act_or_ask(self, state: dict) -> dict:
        plan = self.api.get_plan(state["plan_id"])
        # estimate the leader's cost; over cap (or irreversible) → human-approval (§13 #4)
        leader = max(
            plan["options"],
            key=lambda o: next((v["up"] - v["down"] for v in plan["votes"] if v["optionId"] == o["id"]), 0),
        )
        tier = leader.get("priceTier") or 1
        est = tier * 2000  # rough per-table estimate
        check = self.api.check_spend(state["plan_id"], est)
        decision = "act" if check.get("allowed") else "approve"
        return {
            "act_decision": decision,
            "estimate_cents": est,
            "leader_label": leader["label"],
            # a place-backed leader has a real cost → settle-up should offer a split (§B1)
            "leader_has_cost": bool(leader.get("place")),
            "leader_price_tier": tier,
        }

    def act(self, state: dict) -> dict:
        # lock is reversible (compensating UNLOCK_PLAN) and spends nothing — proceed.
        self.tools.invoke("lock_plan", plan_id=state["plan_id"], reason="soft-deadline auto-lock")
        return {"result": "LOCKED", "decision": "ACT"}

    # ── settle-up: after a lock with a real cost, auto-set-up an even split (§B1). ──
    # Money is least-authority: if the group hasn't granted SPEND_MONEY, Plot doesn't move money —
    # it asks in-thread. The split itself is reversible (refund), so no over-cap approval needed.
    def settle_up(self, state: dict) -> dict:
        if not state.get("leader_has_cost"):
            return {"result": "LOCKED"}  # a free hang (someone's place) → nothing to split
        per_head = (state.get("leader_price_tier") or 2) * 2000  # ~$20/$40/$60/$80pp by price band
        res = self.tools.invoke(
            "create_split",
            plan_id=state["plan_id"],
            per_head_cents=per_head,
            memo=f"Split for {state.get('leader_label')}",
        )
        if res.get("created"):
            ph = res["split"]["perHeadCents"]
            self.tools.invoke(
                "post_message", thread_id=state["thread_id"], plan_id=state["plan_id"],
                body=f"✦ Set up an even split — about ${ph // 100} each. Tap to settle up whenever; I'll chase it so no one has to.",
            )
            return {"result": "LOCKED_AND_SPLIT", "split": res["split"]}
        if res.get("needsPermission"):
            self.tools.invoke(
                "post_message", thread_id=state["thread_id"], plan_id=state["plan_id"],
                body="✦ Want me to handle the money too? Grant the group money access and I'll collect everyone's share so nobody has to be the debt collector.",
            )
            return {"result": "LOCKED_SPLIT_NEEDS_PERMISSION"}
        return {"result": "LOCKED"}

    def human_approval(self, state: dict) -> dict:
        body = (
            f"✦ Heads up — locking \"{state.get('leader_label')}\" would run about "
            f"${state.get('estimate_cents',0)//100}, over the group's cap. Reply 'approve' to proceed."
        )
        self.tools.invoke("post_message", thread_id=state["thread_id"], body=body)
        return {"result": "AWAITING_APPROVAL", "decision": "ASK"}
