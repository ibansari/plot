#!/usr/bin/env bash
# Thin wrapper so the slice can be driven with one command. Requires ./scripts/dev.sh to be running.
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm demo
