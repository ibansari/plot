# ios — PLOT (SwiftUI, iOS 17+)

MVVM + Observation. Mirrors `plot-mockup (1).html` via `Plot/DesignSystem/Theme.swift` +
`Components.swift` (dark/premium/minimal, mint `#5FE6C1`, amber "needs you" `#F2B25C`, ✦ mark,
Sora/Onest/IBM Plex Mono).

## Run on a simulator (verified path)

SwiftPM alone can't emit an iOS `.app`, so the repo ships an **xcodegen** spec (`project.yml`) that
turns the `Plot/` sources into a runnable app. With the backend already up (`./scripts/dev.sh`):

```bash
cd ios
brew install xcodegen          # one-time (already present on this machine)
xcodegen generate              # → Plot.xcodeproj
open Plot.xcodeproj            # pick an iOS 17 simulator → Run
```

Or fully headless (build + install + launch), as used to verify this build:

```bash
xcodebuild -project Plot.xcodeproj -scheme Plot -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build/dd build
xcrun simctl boot "iPhone 17"; open -a Simulator
xcrun simctl install "iPhone 17" "$(find .build/dd/Build/Products -name Plot.app)"
xcrun simctl launch "iPhone 17" com.plot.app
```

The app reads `PLOT_API_BASE_URL` (default `http://localhost:3000`; the simulator reaches your Mac's
localhost directly). ATS allows localhost http in the generated `Info.plist`.

**Dev-only launch hooks** (no effect unless set) used to drive the demo without manual taps —
pass with the `SIMCTL_CHILD_` prefix to `simctl launch`:
- `PLOT_DEV_AUTOLOGIN=+15550000001` — auto sign-in as Alex
- `PLOT_DEV_OPENCREW=1` — jump straight into The Crew thread
- `PLOT_DEV_OPENDESK=1` — auto-open Plot's Desk

## What's wired

- **REST**: `Networking/APIClient.swift` (URLSession, async/await). Equivalent to the generated
  OpenAPI client; the generated client itself comes from `openapi/generate-swift.sh`.
- **Live state**: `Networking/SocketClient.swift` — `URLSessionWebSocketTask` speaking Engine.IO
  v4 / Socket.IO framing (`message.created`, `plan.updated`, `audit.created`).
- **EventKit**: `Calendar/EventKitService.swift` reads the calendar and maps to **busy intervals
  only** before anything leaves the device (§13).
- **Sign in with Apple**: `Auth/SignInWithApple.swift` — works against the dev mock (any token).
- **Decision card**: `Views/DecisionCardView.swift` — options with **↑BOOST / ↓VETO**, a crown on
  the leader, no-booking/booking tags, the amber **soft-deadline banner**, and on resolution the
  locked "confirm" card (time + place + RSVP) + the **bring-list**.
- **Plot's Desk** (`Views/AuditLogView.swift`): live status, self-enforcing contingencies, and the
  **reversible activity log** with per-action **Undo** + the over-cap approval prompt.
- **Tabs + non-user SMS preview**: `Views/MainTabView.swift` (Chats / Plans / Discover / You — You
  surfaces the trust model: per-action permissions + spend cap) and `Views/MembersSheet.swift`
  (members + a preview of how the non-user **Jordan** votes/RSVPs over SMS).
- All styling mirrors `plot-mockup (1).html` via `DesignSystem/Theme.swift` + `Components.swift`.

## Demo login

Phone is pre-filled with the seeded organizer **Alex** (`+15550000001`); the OTP dev code is
`000000` (auto-prefilled). Or tap **Sign in with Apple**.
