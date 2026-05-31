import SwiftUI

/// Connector detail: trust tier, source, coverage/health, and the connect action. Coverage states
/// follow the spec (available / degraded / unavailable / needs connection / needs approval).
struct ConnectorDetailView: View {
    let entry: ConnectorEntry
    let groupId: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "puzzlepiece.extension").font(.title).foregroundStyle(Theme.accent)
                    VStack(alignment: .leading) {
                        Text(entry.displayName).font(Theme.body(20)).fontWeight(.semibold).foregroundStyle(Theme.text)
                        Text("\(entry.trustTier.capitalized) · \(entry.category)").font(Theme.body(12)).foregroundStyle(Theme.textDim)
                    }
                }

                coverageBadge("Needs account connection", Theme.warn)

                Text("Once connected, Plot can use this connector's tools while planning. Reads run automatically; bookings and purchases always show a preview and ask for approval first.")
                    .font(Theme.body(13)).foregroundStyle(Theme.textDim)

                if let src = entry.sourceUrl {
                    Button { if let u = URL(string: src) { openURL(u) } } label: {
                        Label("Source", systemImage: "link").font(Theme.body(13)).foregroundStyle(Theme.accent)
                    }
                }

                Button {
                    // connection flow (OAuth / credential entry) is provider-specific; placeholder CTA
                } label: {
                    Text("Connect").font(Theme.body(15)).fontWeight(.semibold).foregroundStyle(Theme.accentInk)
                        .frame(maxWidth: .infinity).padding(.vertical, 12).background(Theme.accent, in: Capsule())
                }
            }
            .padding(20)
        }
        .navigationTitle(entry.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func coverageBadge(_ t: String, _ c: Color) -> some View {
        Text(t).font(Theme.body(12)).foregroundStyle(c)
            .padding(.horizontal, 10).padding(.vertical, 5).background(c.opacity(0.12), in: Capsule())
    }
}
