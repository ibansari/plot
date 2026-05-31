#!/usr/bin/env bash
# One command: infra up → install → migrate → seed → start api + agent + web (+ inngest in docker).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a

echo "✦ 1/5  Bringing up Postgres + Redis + Inngest…"
docker compose up -d
echo "    waiting for Postgres…"
until docker compose exec -T postgres pg_isready -U plot >/dev/null 2>&1; do sleep 1; done

echo "✦ 2/5  Installing JS deps (pnpm)…"
corepack enable >/dev/null 2>&1 || true
pnpm install

echo "✦ 3/5  Build @plot/db (prisma client + types) + migrate + seed…"
pnpm --filter @plot/db build
pnpm --filter @plot/db prisma:migrate
pnpm --filter @plot/db seed

echo "✦ 4/5  Starting Python agent (:8000)…"
if [ ! -d agent/.venv ]; then
  python3 -m venv agent/.venv
  agent/.venv/bin/pip install -q -e "agent[postgres]" || agent/.venv/bin/pip install -q -e "agent"
fi
( agent/.venv/bin/uvicorn plot_agent.main:app --app-dir agent --port "${AGENT_PORT:-8000}" \
    >/tmp/plot-agent.log 2>&1 & echo $! > /tmp/plot-agent.pid )

echo "✦ 5/5  Starting API (:${API_PORT:-3000}) + Web (:${WEB_PORT:-3001})…"
( pnpm --filter @plot/api dev   >/tmp/plot-api.log 2>&1 & echo $! > /tmp/plot-api.pid )
( pnpm --filter @plot/web dev   >/tmp/plot-web.log 2>&1 & echo $! > /tmp/plot-web.pid )

cat <<EOF

✦ PLOT is up.
   API   http://localhost:${API_PORT:-3000}        logs: tail -f /tmp/plot-api.log
   Web   http://localhost:${WEB_PORT:-3001}         logs: tail -f /tmp/plot-web.log
   Agent http://localhost:${AGENT_PORT:-8000}/health logs: tail -f /tmp/plot-agent.log
   Inngest dashboard http://localhost:8288

Watch the full slice end-to-end (no iOS needed):
   pnpm demo        # or: ./scripts/demo.sh

Stop services:
   kill \$(cat /tmp/plot-api.pid /tmp/plot-web.pid /tmp/plot-agent.pid) ; docker compose down
EOF
