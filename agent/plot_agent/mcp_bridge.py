"""Pull real capabilities into Plot from MCP servers (Google Calendar, Google Maps, Resy/OpenTable…).

Each configured server (PLOT_MCP_SERVERS, see config.py) is connected once; its tools are registered
into the SAME ToolRegistry the agentic loop uses — so Claude can call them like any other tool, and
they flow through the trust gate: a tool listed in the server's `mutating` set (book/reserve/pay/
create_event) is registered `irreversible=True`, so `invoke()` routes it to human-approval; every
other (read) tool is exposed to the loop directly. Nothing here bypasses the gate.

Design: the async MCP transport lives in `McpHub` (a background asyncio loop), behind a small sync
surface (`list_tools`, `call_tool`). The registration + gating logic (`register_mcp_tools`) takes any
hub-shaped object, so it's unit-tested offline with a fake hub — no `mcp` dependency, no live server.
Everything is best-effort: missing `mcp` package, no servers, or a failed connection → no MCP tools,
and the agent runs exactly as before."""
from __future__ import annotations

import logging
import os
import threading

from . import config

log = logging.getLogger("plot-agent.mcp")


def register_mcp_tools(registry, hub, servers: list[dict]) -> int:
    """Register every tool each MCP server exposes into `registry`. Returns the count.
    `hub` only needs `list_tools(server_name) -> [{name, description, inputSchema}]` and
    `call_tool(server_name, tool, args) -> result` — so a fake hub drives this in tests."""
    from .tools import Tool

    count = 0
    for s in servers:
        name = s["name"]
        prefix = s.get("prefix", name)
        mutating = set(s.get("mutating") or [])
        for t in hub.list_tools(name):
            tool_name = f"{prefix}__{t['name']}"
            is_mut = t["name"] in mutating

            def _run(_server=name, _tool=t["name"], **kwargs):
                return hub.call_tool(_server, _tool, kwargs)

            registry.register(Tool(
                name=tool_name,
                scope="",
                irreversible=is_mut,  # mutating MCP tools → always human-approval (§13)
                spends=False,
                run=_run,
                description=f"[{prefix}] {t.get('description', '') or t['name']}",
                input_schema=t.get("inputSchema") or {"type": "object", "properties": {}},
                loop=True,
                proactive=False,  # external services are never called on an uninvited turn
                external=True,
            ))
            count += 1
        log.info("registered %d MCP tool(s) from server '%s'", len(hub.list_tools(name)), name)
    return count


class McpHub:
    """Owns a background event loop that holds one persistent session per configured MCP server.
    Sync `call_tool` dispatches into that loop. Connecting needs the `mcp` package + reachable
    servers; any failure is logged and that server is simply skipped."""

    def __init__(self, servers: list[dict]):
        self.servers = {s["name"]: s for s in servers}
        self._loop = None
        self._thread = None
        self._sessions: dict = {}
        self._tools: dict[str, list[dict]] = {}
        self._ready = threading.Event()
        self._stop = None

    def start(self, timeout: float = 30.0):
        self._thread = threading.Thread(target=lambda: __import__("asyncio").run(self._main()), daemon=True)
        self._thread.start()
        self._ready.wait(timeout=timeout)
        return self

    async def _main(self):
        import asyncio
        from contextlib import AsyncExitStack

        self._loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
            try:
                from mcp.client.streamable_http import streamablehttp_client
            except Exception:
                streamablehttp_client = None
        except Exception as e:
            log.warning("mcp package not available (%s) — no MCP tools. `pip install plot-agent[mcp]`", e)
            self._ready.set()
            return

        async with AsyncExitStack() as stack:
            for name, s in self.servers.items():
                try:
                    if s.get("transport") == "http" and streamablehttp_client:
                        read, write, _ = await stack.enter_async_context(
                            streamablehttp_client(s["url"], headers=s.get("headers") or {}))
                    else:
                        params = StdioServerParameters(
                            command=s["command"], args=s.get("args", []),
                            env={**os.environ, **(s.get("env") or {})})
                        read, write = await stack.enter_async_context(stdio_client(params))
                    session = await stack.enter_async_context(ClientSession(read, write))
                    await session.initialize()
                    listed = await session.list_tools()
                    self._sessions[name] = session
                    self._tools[name] = [
                        {"name": t.name, "description": t.description or "", "inputSchema": t.inputSchema or {"type": "object", "properties": {}}}
                        for t in listed.tools
                    ]
                    log.info("MCP connected: %s (%d tools)", name, len(self._tools[name]))
                except Exception as e:
                    log.warning("MCP server '%s' failed to connect: %s", name, e)
            self._ready.set()
            await self._stop.wait()  # keep sessions open for the process lifetime

    def list_tools(self, name: str) -> list[dict]:
        return self._tools.get(name, [])

    def call_tool(self, name: str, tool: str, args: dict) -> dict:
        import asyncio

        session = self._sessions.get(name)
        if session is None or self._loop is None:
            return {"error": f"MCP server '{name}' not connected"}
        fut = asyncio.run_coroutine_threadsafe(session.call_tool(tool, args or {}), self._loop)
        res = fut.result(timeout=30)
        parts = [getattr(c, "text", "") for c in (getattr(res, "content", []) or []) if getattr(c, "type", None) == "text"]
        return {"content": "\n".join(p for p in parts if p) or str(res), "isError": bool(getattr(res, "isError", False))}


def load_mcp(registry) -> McpHub | None:
    """Connect configured MCP servers and register their tools into `registry`. No-op (returns None)
    when nothing is configured, so the agent is unchanged unless the operator opts in."""
    servers = config.MCP_SERVERS
    if not servers:
        return None
    try:
        hub = McpHub(servers).start()
        n = register_mcp_tools(registry, hub, servers)
        log.info("MCP: %d tool(s) from %d server(s) now available to the loop", n, len(servers))
        return hub
    except Exception as e:
        log.warning("MCP load failed (%s) — continuing without MCP tools", e)
        return None
