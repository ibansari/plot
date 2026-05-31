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
