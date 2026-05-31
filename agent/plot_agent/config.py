import json
import os

# Defaults mirror .env.example so the agent runs with zero real keys.
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000")
# the API trusts internal calls carrying this header == JWT_SECRET (dev network only)
INTERNAL_SECRET = os.environ.get("JWT_SECRET", "dev-only-change-me")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")  # absent => deterministic fallback
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
DEFAULT_SPEND_CAP_CENTS = int(os.environ.get("PLOT_DEFAULT_SPEND_CAP_CENTS", "5000"))

# Demo anchor used to construct the availability window the agent searches.
# Matches the seed's "now" so suggestions land on the seeded busy/free data.
DEMO_NOW_ISO = os.environ.get("PLOT_DEMO_NOW_ISO", "2026-06-05T18:00:00.000Z")  # a Friday


# ── MCP servers the agent pulls real capabilities from (Google Calendar, Maps, Resy/OpenTable…) ──
# PLOT_MCP_SERVERS is a JSON array; each entry connects one MCP server and exposes its tools to the
# loop THROUGH the trust gate. Empty/unset → no MCP tools (the agent runs exactly as before).
#   stdio:  {"name":"maps","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-google-maps"],"env":{"GOOGLE_MAPS_API_KEY":"…"},"mutating":[]}
#   http:   {"name":"resy","transport":"http","url":"https://…/mcp","headers":{"Authorization":"Bearer …"},"mutating":["book_reservation"]}
# `mutating` lists tool names that change the world (book/reserve/pay/create_event) — those are
# registered irreversible → they always route to human-approval (§13). Everything else is read-only
# and offered to the loop directly. Optional `prefix` (default = name) namespaces the tool names.
def _parse_mcp_servers() -> list[dict]:
    raw = os.environ.get("PLOT_MCP_SERVERS", "").strip()
    if not raw:
        return []
    try:
        servers = json.loads(raw)
        return servers if isinstance(servers, list) else []
    except Exception:
        return []


MCP_SERVERS = _parse_mcp_servers()
