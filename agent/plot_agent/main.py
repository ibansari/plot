"""FastAPI service that hosts the LangGraph agent. The API triggers /run on every human message;
Inngest re-enters /run with trigger='deadline' at the soft deadline."""
from __future__ import annotations
import logging
import uuid
from fastapi import FastAPI
from pydantic import BaseModel
from .graph import build_graph, AgentState
from .nodes import AgentNodes

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("plot-agent")

app = FastAPI(title="PLOT Agent")
_nodes = AgentNodes()
_graph = build_graph(_nodes)


class RunRequest(BaseModel):
    threadId: str
    planId: str | None = None
    trigger: str = "message"  # "message" | "confirmed_intent" | "deadline"


@app.get("/health")
def health():
    from . import config
    # the brain is the only intelligence path; with no key it returns safe defaults (Plot stays quiet)
    return {
        "ok": True,
        "model": config.ANTHROPIC_MODEL,
        "llm": "claude" if config.ANTHROPIC_API_KEY else "no-key (safe defaults; set ANTHROPIC_API_KEY)",
    }


@app.post("/run")
def run(req: RunRequest):
    # Each run gets its own checkpoint thread so persisted channels never bleed between runs;
    # state is rebuilt from the API every run (dispatch reloads fresh context).
    cfg = {"configurable": {"thread_id": f"{req.threadId}:{req.planId or 'chat'}:{uuid.uuid4().hex[:8]}"}}
    state: AgentState = {"thread_id": req.threadId, "plan_id": req.planId, "trigger": req.trigger}
    final = _graph.invoke(state, cfg)
    log.info("run thread=%s trigger=%s → decision=%s result=%s",
             req.threadId, req.trigger, final.get("decision"), final.get("result"))
    return {
        "decision": final.get("decision"),
        "result": final.get("result"),
        "planId": final.get("plan_id"),
        "intent": final.get("intent"),
        "invited": final.get("invited"),
    }
