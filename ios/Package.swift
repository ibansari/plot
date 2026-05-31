// swift-tools-version:5.9
import PackageDescription

// PLOT iOS. The slice ships a zero-dependency, URLSession-based REST client + Codable models so the
// package resolves and compiles offline with no SPM fetch. The GENERATED Swift OpenAPI client is
// wired separately via `openapi/generate-swift.sh` (and the swift-openapi-generator plugin, kept
// out of this target so a first-run network fetch never blocks compilation). See ios/README.md.
//
// SwiftPM cannot emit an iOS .app on its own; open this package in Xcode 15+, which creates a
// runnable app from the `Plot` library's @main `PlotApp`. ios/README.md has the exact steps.
let package = Package(
    name: "Plot",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "Plot", targets: ["Plot"]),
    ],
    targets: [
        .target(
            name: "Plot",
            path: "Plot"
        ),
        .testTarget(
            name: "PlotTests",
            dependencies: ["Plot"],
            path: "PlotTests"
        ),
    ]
)
