"""The agentic message loop — Claude drives.

Replaces the fixed message-path pipeline (detect → gather → research → propose). Here Claude is given
the live thread, the group's constraints, and a real toolset, and decides which tools to call and in
what order — so it handles "sushi tonight", an open question, or a trip discussion with the same loop,
and stays silent on banter.

The trust model is unchanged: every tool still flows through `ToolRegistry.invoke()` (permission /
spend / irreversible gate BEFORE) and the API writes the audit row AFTER. The loop only changes WHO
picks the next tool. Hard stops (step cap, per-run mutating ceilings, blocked→tool_result) are
enforced here in code, never by trusting the model. With no LLM, it falls back to the deterministic
propose path so the agent never crashes and never acts un-gated."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

log = logging.getLogger("plot-agent.loop")

from .tools import ApprovalRequired
from .brain import _LOOP_SYSTEM
from .constraints import active_constraints
from . import config

MAX_STEPS = 8
# per-run ceilings on mutating tools — one decision card per turn (no duplicate proposals); a
# follow-up message can refine or add the next trip segment.
CEILINGS = {"propose_plan": 1}


def _now() -> datetime:
    try:
        return datetime.fromisoformat(config.DEMO_NOW_ISO.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


class AgentLoop:
    def __init__(self, tools, brain):
        self.tools = tools
        self.brain = brain

    def run_turn(self, state: dict, fallback) -> dict:
        ctx = state["context"]
        trigger = state.get("trigger", "message")
        tool_schemas = self.tools.tool_schemas(trigger)
        messages = [{"role": "user", "content": self._digest(ctx, state)}]
        counts: dict[str, int] = {}
        result: dict = {"decision": (state.get("intent") or {}).get("decision", "ACT"), "result": "NOOP"}
        invited: list[str] = []
        spoke = False

        for _step in range(MAX_STEPS):
            resp = self.brain.run_loop_step(_LOOP_SYSTEM, messages, tool_schemas)
            if resp is None:
                return fallback(state)  # LLM unavailable → deterministic path (never un-gated)

            content = list(getattr(resp, "content", []) or [])
            messages.append({"role": "assistant", "content": content})
            tool_uses = [b for b in content if getattr(b, "type", None) == "tool_use"]
            if not tool_uses:
                break  # Claude ended its turn without (more) tool calls

            tool_results = []
            finished = False
            for tu in tool_uses:
                name = getattr(tu, "name", None)
                args = dict(getattr(tu, "input", {}) or {})
                tid = getattr(tu, "id", "")
                if name == "finish_turn":
                    finished = True
                    tool_results.append(self._tr(tid, {"ok": True}))
                    continue
                counts[name] = counts.get(name, 0) + 1
                if name in CEILINGS and counts[name] > CEILINGS[name]:
                    tool_results.append(self._tr(tid, {"blocked": f"per-turn limit reached for {name}"}))
                    continue
                log.info("loop tool call: %s %s", name, list(args.keys()))
                try:
                    out = self._dispatch(name, args, ctx, state)
                    if name == "post_message":
                        spoke = True
                    if name == "propose_plan" and isinstance(out, dict) and out.get("id"):
                        result["plan_id"] = out["id"]
                        result["result"] = "PROPOSED"
                        result["decision"] = "ACT"
                        invited += self._invite_non_users(ctx, out["id"])
                    tool_results.append(self._tr(tid, self._summarize(name, out)))
                except ApprovalRequired as e:
                    # the gate fired — tell Claude; it can post_message to ask, but can't act around it
                    tool_results.append(self._tr(tid, {"blocked": f"needs human approval: {e.summary}"}))
                except Exception as e:
                    tool_results.append(self._tr(tid, {"error": f"{e.__class__.__name__}: {str(e)[:140]}"}))
            messages.append({"role": "user", "content": tool_results})
            if finished:
                break

        result["invited"] = invited
        if result["result"] == "NOOP" and spoke:
            result["result"] = "SPOKE"
        return result

    # ── world-state digest Claude reasons over ──
    def _digest(self, ctx: dict, state: dict) -> str:
        members = ctx.get("members", [])
        cons = active_constraints(members, now=_now())
        con_lines = "\n".join(f"- {c.member}: {c.text} ({c.kind})" for c in cons) or "- (none on record)"
        mem = ", ".join((m.get("name", "?") + (" [non-user/SMS]" if m.get("isNonUser") else "")) for m in members)
        transcript = "\n".join(f"{m.get('authorName', '?')}: {m['body']}" for m in ctx.get("messages", [])[-20:])
        intent = state.get("intent") or {}
        hint = ""
        if intent:
            hint = (f"\nQuick first read (you may override): decision={intent.get('decision')}, "
                    f"activity={intent.get('activity')}, time={intent.get('time_hint')}.")
        # if a decision card is already open, tell Claude NOT to create a duplicate — answer/refine
        open_card = next((m for m in reversed(ctx.get("messages", [])) if m.get("kind") == "DECISION_CARD"), None)
        card_note = ""
        if open_card:
            card_note = (
                f"\n\nA decision card is ALREADY OPEN for this group: \"{(open_card.get('body') or '')[:120]}\". "
                "Do NOT call propose_plan again — that would post a duplicate. Instead answer the latest "
                "message directly with post_message (e.g. read the plan or report travel times), or if a real "
                "change is needed say so. Only propose a NEW card for a genuinely different plan."
            )
        return (
            f"Current time: {_now().isoformat()}\n"
            f"Group: {mem}\n"
            f"Known constraints (apply silently):\n{con_lines}{hint}{card_note}\n\n"
            f"Recent thread (oldest → newest):\n{transcript}\n\n"
            f"Decide what, if anything, to do for the group right now. Call tools as needed, then finish_turn."
        )

    # ── map Claude's tool args → the gated registry call, injecting thread/group context ──
    def _dispatch(self, name: str, args: dict, ctx: dict, state: dict):
        if name == "gather_availability":
            return self.tools.invoke("gather_availability", group_id=ctx["groupId"],
                                     from_iso=args.get("from_iso"), to_iso=args.get("to_iso"))
        if name == "research_places":
            org = ctx.get("organizerId") or next((m["userId"] for m in ctx.get("members", []) if m.get("userId")), "")
            return self.tools.invoke("research_places", user_id=org, group_id=ctx["groupId"],
                                     query=args.get("query", ""), near=args.get("near"))
        if name == "maps_feasibility":
            return self.tools.invoke(
                "maps_feasibility", group_id=ctx["groupId"], query=args.get("query", ""),
                near=args.get("near"), plan_id=state.get("plan_id"),
            )
        if name == "weather_check":
            return self.tools.invoke("weather_check", near=args.get("near", ""), when=args.get("when"))
        if name == "get_plan":
            return self.tools.invoke("get_plan", plan_id=args.get("plan_id"))
        if name == "post_message":
            return self.tools.invoke("post_message", thread_id=state["thread_id"],
                                     body=args.get("body", ""), plan_id=args.get("plan_id"))
        if name == "propose_plan":
            payload = {
                "threadId": state["thread_id"], "groupId": ctx["groupId"],
                "title": args.get("title", "Plan"),
                "options": args.get("options", []),
                "organizerId": ctx.get("organizerId"),
                "spendCapCents": config.DEFAULT_SPEND_CAP_CENTS,
                "method": args.get("method", "boost_veto"),
                "summary": args.get("summary"),
            }
            return self.tools.invoke("propose_plan", payload=payload)
        # any other registered tool — e.g. an MCP-server tool (Calendar/Maps/Resy). Pass Claude's
        # args straight through invoke(), which still applies the permission / irreversible gate.
        if name in self.tools._tools:
            return self.tools.invoke(name, **args)
        raise ValueError(f"unknown tool: {name}")

    def _invite_non_users(self, ctx: dict, plan_id: str) -> list[str]:
        invited = []
        for m in ctx.get("members", []):
            if m.get("isNonUser") and m.get("contactId"):
                try:
                    self.tools.invoke("invite_non_user", plan_id=plan_id, contact_id=m["contactId"], purpose="vote")
                    invited.append(m["name"])
                except Exception:
                    pass
        return invited

    # ── compact tool_result content (keep tokens small) ──
    def _summarize(self, name: str, out) -> dict:
        if name == "research_places" and isinstance(out, list):
            return {"places": [{"name": p.get("name"), "priceTier": p.get("priceTier"), "address": p.get("address"), "tags": p.get("tags")} for p in out[:6]]}
        if name == "gather_availability" and isinstance(out, dict):
            return {"suggestions": (out.get("suggestions") or [])[:4], "windowFrom": out.get("windowFrom"), "windowTo": out.get("windowTo")}
        if name == "propose_plan" and isinstance(out, dict):
            return {"planId": out.get("id"), "state": out.get("state"), "options": [o.get("label") for o in (out.get("options") or [])]}
        if name == "get_plan" and isinstance(out, dict):
            return {"state": out.get("state"), "options": [o.get("label") for o in (out.get("options") or [])], "votes": out.get("votes")}
        if name == "maps_feasibility" and isinstance(out, dict):
            cands = [c for c in (out.get("candidates") or []) if not c.get("removed")][:5]
            return {
                "status": out.get("status"), "reason": out.get("reason"),
                "venues": [{
                    "name": c["venue"].get("name"),
                    "fairness": round(c["travel"].get("fairnessScore", 0)),
                    "medianEtaMin": c["travel"].get("medianEtaMin"),
                    "etas": [{"name": n["name"], "min": n["durationMin"], "mode": n["mode"], "flag": n["guardrail"]} for n in c["travel"].get("namedEtas", [])],
                } for c in cands],
                "attribution": out.get("attribution"),
            }
        if name == "post_message":
            return {"posted": True}
        # MCP tools (Calendar/Maps/Resy …) and anything else: hand the result back, truncated
        if isinstance(out, dict):
            return out
        return {"result": str(out)[:1500]}

    def _tr(self, tool_use_id: str, obj: dict) -> dict:
        return {"type": "tool_result", "tool_use_id": tool_use_id, "content": json.dumps(obj, default=str)}
