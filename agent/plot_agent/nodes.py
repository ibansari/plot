"""The graph's nodes. Each node is a pure-ish function of state → partial state. Side effects go
through the typed tool registry (which gates permission/cap) and the API (which audits)."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any
from .api_client import ApiClient
from .tools import ToolRegistry, ApprovalRequired, build_decision_options
from .constraints import active_constraints, default_expiry
from .brain import Brain, apply_reasoning
from .summary import choose_method, proposal_summary  # deterministic fallback when the LLM is down
from . import config


def _now() -> datetime:
    try:
        return datetime.fromisoformat(config.DEMO_NOW_ISO.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


class AgentNodes:
    def __init__(self, api: ApiClient | None = None, brain: Brain | None = None):
        self.api = api or ApiClient()
        self.tools = ToolRegistry(self.api)
        self.brain = brain or Brain()
        # pull in any configured MCP servers (Google Calendar / Maps / Resy …) as gated loop tools.
        # best-effort: no servers configured or connect fails → the agent runs exactly as before.
        try:
            from .mcp_bridge import load_mcp

            self._mcp = load_mcp(self.tools)
        except Exception:
            self._mcp = None

    # entry: always load FRESH thread context (never reuse a checkpointed snapshot, or we'd
    # classify a stale "latest message").
    def dispatch(self, state: dict) -> dict:
        return {"context": self.api.context(state["thread_id"])}

    # ── detect-intent: Claude classifies ACT/STAY_QUIET/ASK and extracts any stated constraint,
    # in ONE structured call. The latest speaker is attached so `remember` knows whose it is. ──
    def detect_intent(self, state: dict) -> dict:
        ctx = state["context"]
        analysis = self.brain.analyze_message(ctx["messages"])
        out: dict = {"intent": {
            "decision": analysis.decision, "activity": analysis.activity,
            "time_hint": analysis.time_hint, "question": analysis.question, "rationale": analysis.rationale,
        }}
        if analysis.constraint:
            human = [m for m in ctx.get("messages", []) if not m.get("isAgent")]
            author = human[-1].get("authorName") if human else None
            out["stated_constraint"] = {
                "member": author,
                "text": analysis.constraint.text,
                "kind": analysis.constraint.kind,
                "temporary": analysis.constraint.temporary,
            }
        return out

    # ── remember: silently persist the constraint the brain extracted (§A7). Writes memory, never
    # speaks. Runs after detect-intent on every message; no second LLM call. ──
    def remember(self, state: dict) -> dict:
        sc = state.get("stated_constraint")
        if not sc or not sc.get("member"):
            return {}
        ctx = state["context"]
        member = next((m for m in ctx.get("members", []) if m.get("name") == sc["member"]), None)
        if not member:
            return {}
        expires_at = default_expiry(_now()) if sc.get("temporary") else None
        try:
            self.tools.invoke(
                "remember_constraint",
                group_id=ctx["groupId"], text=sc["text"], kind=sc["kind"],
                user_id=member.get("userId"), contact_id=member.get("contactId"),
                expires_at=expires_at,
            )
        except Exception:
            pass  # memory is best-effort; never block the turn on it
        return {"remembered": {"member": sc["member"], "text": sc["text"], "kind": sc["kind"]}}

    def stay_quiet(self, state: dict) -> dict:
        # silence is NOT an action: no message, no audit row (§9).
        return {"result": "STAY_QUIET", "decision": "STAY_QUIET"}

    def route_after_remember(self, state: dict) -> str:
        decision = (state.get("intent") or {}).get("decision")
        if state.get("trigger") == "confirmed_intent":
            return "loop"
        if decision == "STAY_QUIET":
            return "quiet"
        # Only OFFER ("suggest") for genuinely fresh planning intent. If the group is replying to an
        # open suggestion, refining a live plan, or asking a question, go straight to the loop so Plot
        # drafts/answers instead of re-posting the same "want me to draft?" nudge (the suggestion loop).
        cmd, sug, plan, q = (self._is_explicit_command(state), self._has_open_suggestion(state),
                             self._has_live_plan(state), self._latest_is_question(state))
        route = "suggest" if (decision == "ACT" and not cmd and not sug and not plan and not q) else "loop"
        import logging
        logging.getLogger("plot-agent").info(
            "route: decision=%s command=%s open_suggestion=%s live_plan=%s question=%s → %s",
            decision, cmd, sug, plan, q, route)
        return route

    # ── context helpers (use message kind/metadata surfaced by the API) ──
    def _recent_human(self, state: dict) -> dict | None:
        msgs = (state.get("context") or {}).get("messages") or []
        human = [m for m in msgs if not m.get("isAgent")]
        return human[-1] if human else None

    def _has_open_suggestion(self, state: dict) -> bool:
        # the latest agent message is an unhandled Plot suggestion → the user is responding to it
        msgs = (state.get("context") or {}).get("messages") or []
        last_agent = next((m for m in reversed(msgs) if m.get("isAgent")), None)
        meta = (last_agent or {}).get("metadata") or {}
        return meta.get("kind") == "plot_suggestion" and meta.get("status", "open") == "open"

    def _has_live_plan(self, state: dict) -> bool:
        # a decision card already exists in the recent thread → refine/answer, don't re-suggest
        msgs = (state.get("context") or {}).get("messages") or []
        return any(m.get("kind") == "DECISION_CARD" for m in msgs[-10:])

    def _latest_is_question(self, state: dict) -> bool:
        m = self._recent_human(state)
        return bool(m and "?" in (m.get("body") or ""))

    def suggest_plan(self, state: dict) -> dict:
        # never stack suggestions — if one is already open, stay quiet (the router usually prevents
        # reaching here, but this guards against rapid repeat messages).
        if self._has_open_suggestion(state):
            return {"result": "NOOP", "decision": "STAY_QUIET"}
        intent = state.get("intent") or {}
        activity = intent.get("activity") or "a plan"
        time_hint = intent.get("time_hint")
        subject = f"{time_hint} {activity}" if time_hint and time_hint.lower() not in activity.lower() else activity
        body = f"✦ Looks like {subject} is becoming real. Want me to draft a few options?"
        self.api.post_agent_message(
            state["thread_id"],
            body,
            metadata={
                "kind": "plot_suggestion",
                "status": "open",
                "actions": ["draft_options", "dismiss"],
                "activity": intent.get("activity"),
                "timeHint": time_hint,
            },
        )
        return {"result": "SUGGESTED", "decision": "ASK"}

    def _is_explicit_command(self, state: dict) -> bool:
        ctx = state.get("context") or {}
        messages = ctx.get("messages") or ctx.get("recent_messages") or []
        human = [m for m in messages if not m.get("isAgent") and m.get("kind") not in ("AGENT", "DECISION_CARD")]
        body = (human[-1].get("body", "") if human else "").lower()
        return "plot" in body and any(phrase in body for phrase in ("sort this", "draft", "plan this", "find options"))

    # ── the agentic loop: Claude chooses tools to resolve the conversation (replaces the fixed
    # gather→research→propose pipeline and the old single-shot `ask`). ──
    def agent_loop(self, state: dict) -> dict:
        from .loop import AgentLoop

        return AgentLoop(self.tools, self.brain).run_turn(state, self._deterministic_propose)

    # deterministic fallback used when the LLM loop is unavailable (no key / API error). Runs the
    # original gather → research → propose path so the agent still resolves and never acts un-gated.
    def _deterministic_propose(self, state: dict) -> dict:
        intent = state.get("intent") or {}
        if intent.get("decision") == "ASK":
            q = intent.get("question") or "When works, and what are you all in the mood for?"
            self.tools.invoke("post_message", thread_id=state["thread_id"], body=f"✦ {q}")
            return {"result": "ASK", "decision": "ASK"}
        state = {**state, **self.gather_availability(state)}
        state = {**state, **self.research(state)}
        return self.propose_decision(state)

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

    # ── propose-decision: build mixed options and post a draft card for the group to shape ──
    def propose_decision(self, state: dict) -> dict:
        ctx = state["context"]
        activity = state.get("activity") or "hang"
        time_hint = (state.get("intent") or {}).get("time_hint")
        # assemble candidate options, then let Claude reason over them against the group's constraints
        base_options = build_decision_options(
            state.get("availability") or {}, state.get("places") or [], activity,
        )
        constraints = active_constraints(ctx.get("members") or [], now=_now())  # drop expired (§A7)
        reasoning = self.brain.reason_about_options(activity, time_hint, base_options, constraints)
        options = apply_reasoning(base_options, reasoning)
        if reasoning is not None:
            method, summary = reasoning.method, reasoning.summary
        else:  # LLM unavailable → conservative deterministic fallback (not regex): count + template
            method = choose_method(options)
            summary = proposal_summary(activity, time_hint, options)
        title = f"{activity.capitalize()} — {time_hint or 'soon'}"
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
        # Bridge to non-users: text each Contact a signed vote link. It becomes actionable once a
        # member starts voting from the shared draft card.
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
        plan = self.tools.invoke("lock_plan", plan_id=state["plan_id"], reason="soft-deadline auto-lock")
        if plan.get("state") not in ("LOCKED", "BOOKED"):
            return {"result": "AWAITING_GROUP_PICK", "decision": "ASK"}
        invited = []
        for member in (state.get("context") or {}).get("members", []):
            if member.get("isNonUser") and member.get("contactId"):
                self.tools.invoke("invite_non_user", plan_id=state["plan_id"], contact_id=member["contactId"], purpose="rsvp")
                invited.append(member["name"])
        return {"result": "LOCKED", "decision": "ACT", "invited": invited}

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
