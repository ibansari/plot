# openapi

`openapi.yaml` is the hand-authored REST contract — the **source of truth** for both the NestJS
API (which implements these operations) and the iOS app (which consumes a generated client).

- **iOS**: `ios/Package.swift` wires the **swift-openapi-generator build plugin**, so the typed
  client + models are generated at Xcode build time from `openapi.yaml` (symlinked into the target
  as `Networking/openapi.yaml`, with `openapi-generator-config.yaml` alongside). No checked-in
  generated code; nothing to run by hand.
- **CLI / CI**: `./generate-swift.sh` produces the same client outside Xcode if you have the
  `swift-openapi-generator` CLI installed.

Live plan/chat state is delivered over **Socket.IO** (events `message.created`, `plan.updated`,
`audit.created`), which is intentionally outside the OpenAPI document; see
`ios/Plot/Networking/SocketClient.swift` and `api/src/common/realtime.gateway.ts`.
