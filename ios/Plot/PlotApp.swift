import SwiftUI

/// App entry point. (When wrapping this library in an Xcode App target, this @main type is the
/// app's entry — see ios/README.md.)
@main
public struct PlotApp: App {
    public init() {}
    public var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}
