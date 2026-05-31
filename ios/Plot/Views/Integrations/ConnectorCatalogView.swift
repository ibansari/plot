import SwiftUI

/// Browse the curated MCP connector catalog grouped by category, with trust tier + coverage state.
/// (Spec §Connector Catalog.)
struct ConnectorCatalogView: View {
    let groupId: String
    @State private var entries: [ConnectorEntry] = []
    @State private var loading = true
    @State private var error: String?

    private var grouped: [(String, [ConnectorEntry])] {
        Dictionary(grouping: entries, by: { $0.category })
            .sorted { $0.key < $1.key }
            .map { (label($0.key), $0.value) }
    }

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(Theme.danger).font(Theme.body(13)) }
            ForEach(grouped, id: \.0) { (cat, items) in
                Section(cat) {
                    ForEach(items) { e in
                        NavigationLink(value: e) {
                            HStack(spacing: 10) {
                                Image(systemName: icon(e.category)).foregroundStyle(Theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.displayName).font(Theme.body(15)).foregroundStyle(Theme.text)
                                    Text(e.trustTier.capitalized).font(Theme.body(11)).foregroundStyle(tierColor(e.trustTier))
                                }
                            }
                        }
                    }
                }
            }
        }
        .overlay { if loading { ProgressView() } }
        .navigationTitle("Connectors")
        .navigationDestination(for: ConnectorEntry.self) { ConnectorDetailView(entry: $0, groupId: groupId) }
        .task {
            do { entries = try await APIClient.shared.connectorCatalog() }
            catch { self.error = "Couldn't load connectors: \(error.localizedDescription)" }
            loading = false
        }
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
