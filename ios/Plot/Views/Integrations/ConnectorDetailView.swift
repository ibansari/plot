import SwiftUI

/// Connector detail: trust tier, source, coverage/health, and the connect action. Coverage states
/// follow the spec (available / degraded / unavailable / needs connection / needs approval).
struct ConnectorDetailView: View {
    let entry: ConnectorEntry
    let groupId: String
    var onChange: () -> Void = {}
    @Environment(\.openURL) private var openURL

    @State private var connection: ConnectorConnectionState?
    @State private var busy = false
    @State private var error: String?

    // weatherkit (and anything without a backing server) isn't user-connectable.
    private var connectable: Bool { entry.connectable ?? true }

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

                statusBadge

                Text("Once connected, Plot can use this connector's tools while planning. Reads run automatically; bookings and purchases always show a preview and ask for approval first.")
                    .font(Theme.body(13)).foregroundStyle(Theme.textDim)

                if let src = entry.sourceUrl {
                    Button { if let u = URL(string: src) { openURL(u) } } label: {
                        Label("Source", systemImage: "link").font(Theme.body(13)).foregroundStyle(Theme.accent)
                    }
                }

                if let error { Text(error).font(Theme.body(12)).foregroundStyle(Theme.danger) }

                actionButton
            }
            .padding(20)
        }
        .navigationTitle(entry.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if connection == nil { connection = entry.connection } }
    }

    @ViewBuilder private var statusBadge: some View {
        if !connectable {
            coverageBadge("Built in — always available", Theme.accent)
        } else if let c = connection {
            let down = c.health != "ok"
            coverageBadge(down ? "Connected · degraded" : "Connected · \(c.toolCount) tool\(c.toolCount == 1 ? "" : "s")",
                          down ? Theme.warn : Theme.accent)
        } else {
            coverageBadge("Needs connection", Theme.warn)
        }
    }

    @ViewBuilder private var actionButton: some View {
        if !connectable {
            EmptyView()
        } else if connection != nil {
            Button(role: .destructive) { Task { await disconnect() } } label: {
                label(busy ? "Disconnecting…" : "Disconnect", filled: false)
            }.disabled(busy)
        } else {
            Button { Task { await connect() } } label: {
                label(busy ? "Connecting…" : "Connect", filled: true)
            }.disabled(busy || groupId.isEmpty)
        }
    }

    private func connect() async {
        busy = true; error = nil
        do {
            let r = try await APIClient.shared.connectConnector(key: entry.key, groupId: groupId)
            connection = ConnectorConnectionState(connected: true, health: r.health, coverage: r.coverage, toolCount: r.tools.count)
            onChange()
        } catch { self.error = "Couldn't connect: \(error.localizedDescription)" }
        busy = false
    }

    private func disconnect() async {
        busy = true; error = nil
        do {
            _ = try await APIClient.shared.disconnectConnector(key: entry.key, groupId: groupId)
            connection = nil
            onChange()
        } catch { self.error = "Couldn't disconnect: \(error.localizedDescription)" }
        busy = false
    }

    private func label(_ t: String, filled: Bool) -> some View {
        Text(t).font(Theme.body(15)).fontWeight(.semibold)
            .foregroundStyle(filled ? Theme.accentInk : Theme.danger)
            .frame(maxWidth: .infinity).padding(.vertical, 12)
            .background(filled ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.danger.opacity(0.12)), in: Capsule())
    }

    private func coverageBadge(_ t: String, _ c: Color) -> some View {
        Text(t).font(Theme.body(12)).foregroundStyle(c)
            .padding(.horizontal, 10).padding(.vertical, 5).background(c.opacity(0.12), in: Capsule())
    }
}
