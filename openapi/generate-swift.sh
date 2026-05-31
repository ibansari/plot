#!/usr/bin/env bash
# Regenerate the Swift OpenAPI client into the iOS package.
#
# The iOS Package.swift wires the swift-openapi-generator BUILD PLUGIN, so in normal use the
# client is generated automatically at Xcode build time from this same openapi.yaml (symlinked
# into the target). This script is the CLI equivalent for CI / out-of-Xcode generation.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! command -v swift-openapi-generator >/dev/null 2>&1; then
  cat <<'EOF'
swift-openapi-generator CLI not found. Two options:
  1. Just build the iOS app — Package.swift runs the generator plugin automatically. (recommended)
  2. Install the CLI:  brew install swift-openapi-generator   (or build from apple/swift-openapi-generator)
EOF
  exit 0
fi

OUT="$HERE/../ios/Plot/Networking/Generated"
mkdir -p "$OUT"
swift-openapi-generator generate \
  --mode types --mode client \
  --output-directory "$OUT" \
  "$HERE/openapi.yaml"
echo "✦ Generated Swift client into $OUT"
