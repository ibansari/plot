import SwiftUI

/// Browse the curated MCP connector catalog grouped by category, with trust tier + coverage state.
/// (Spec §Connector Catalog.)
struct ConnectorCatalogView: View {
    let groupId: String
    @State private var entries: [ConnectorEntry] = []
    @State private var path: [ConnectorEntry] = []
    @State private var loading = true
    @State private var error: String?
    // The group actually used for per-group connection state — `groupId` if the caller passed one,
    // otherwise the first group the user belongs to (resolved in load()). This is what the detail
    // view needs to connect; passing the bare `groupId` prop would leave Connect disabled.
    @State private var resolvedGroupId = ""

    private var grouped: [(String, [ConnectorEntry])] {
        Dictionary(grouping: entries, by: { $0.category })
            .sorted { $0.key < $1.key }
            .map { (label($0.key), $0.value) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            listBody
                .overlay { if loading { ProgressView() } }
                .navigationTitle("Connectors")
                .navigationDestination(for: ConnectorEntry.self) { e in
                    ConnectorDetailView(entry: e, groupId: resolvedGroupId, onChange: { Task { await load() } })
                }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var listBody: some View {
        List {
            if let error { Text(error).foregroundStyle(Theme.danger).font(Theme.body(13)) }
            ForEach(grouped, id: \.0) { (cat, items) in
                Section(cat) {
                    ForEach(items) { e in
                        NavigationLink(value: e) { row(e) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func row(_ e: ConnectorEntry) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon(e.category)).foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.displayName).font(Theme.body(15)).foregroundStyle(Theme.text)
                Text(e.trustTier.capitalized).font(Theme.body(11)).foregroundStyle(tierColor(e.trustTier))
            }
            Spacer()
            if e.connection != nil {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent).font(Theme.body(15))
            }
        }
    }

    private func load() async {
        do {
            // Resolve a group so we get per-group connection state; fall back to the first group the
            // user belongs to if the caller didn't pass one. Bare catalog only if there's no group.
            var gid = groupId
            if gid.isEmpty { gid = (try? await APIClient.shared.myGroups())?.first?.id ?? "" }
            resolvedGroupId = gid
            entries = gid.isEmpty
                ? try await APIClient.shared.connectorCatalog()
                : try await APIClient.shared.connectors(groupId: gid)
            // dev convenience: deep-link straight into a connector's detail (e.g. "connector:resy")
            let open = ProcessInfo.processInfo.environment["PLOT_DEV_OPEN"] ?? ""
            if open.hasPrefix("connector:"), path.isEmpty,
               let e = entries.first(where: { $0.key == String(open.dropFirst("connector:".count)) }) {
                path = [e]
            }
        } catch {
            self.error = "Couldn't load connectors: \(error.localizedDescription)"
        }
        loading = false
    }

    private func label(_ k: String) -> String {
        switch k { case "core": return "Core coordination"; case "going_out": return "Going out"; case "trips": return "Trips"; default: return k.capitalized }
    }
    private func icon(_ k: String) -> String {
        switch k { case "core": return "calendar"; case "going_out": return "fork.knife"; case "trips": return "airplane"; default: return "puzzlepiece" }
    }
    private func tierColor(_ t: String) -> Color {
        switch t { case "official": return Theme.accent; case "partner": return Theme.pop; default: return Theme.textFaint }
    }
}
