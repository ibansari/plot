import SwiftUI

public struct RootView: View {
    @State private var auth = AuthViewModel()

    public init() {}

    public var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if let session = auth.session {
                MainTabView(session: session)
                    .transition(.opacity)
            } else {
                LoginView(auth: auth)
            }
        }
        .tint(Theme.accent)
        .animation(.easeInOut, value: auth.isAuthed)
        .task { await auth.autoLoginIfConfigured() }
    }
}
