import SwiftUI

/// Renders an MCP gateway `RenderEnvelope` — the generic rung of the rendering ladder. Unknown
/// results never appear as raw JSON: they become key/value fields, list items, links, freshness,
/// attribution, and (for mutations) an approval call-to-action. (Spec §UI Rendering Envelope.)
struct IntegrationResultCard: View {
    let envelope: RenderEnvelope
    var onApprove: ((RenderEnvelope.Action) -> Void)? = nil
    @Environment(\.openURL) private var openURL

    var body: some View {
        PlotCard {
            VStack(alignment: .leading, spacing: 10) {
                header
                if let summary = envelope.summary, !summary.isEmpty {
                    Text(summary).font(Theme.body(13)).foregroundStyle(Theme.textDim)
                }
                if let fields = envelope.fields, !fields.isEmpty { fieldGrid(fields) }
                if let items = envelope.items, !items.isEmpty {
                    VStack(alignment: .leading, spacing: 8) { ForEach(items) { itemRow($0) } }
                }
                if let links = envelope.links, !links.isEmpty {
                    HStack { ForEach(links, id: \.url) { l in linkChip(l) } }
                }
                if let actions = envelope.actions, !actions.isEmpty { actionRow(actions) }
                footer
            }
            .padding(14)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(Theme.accent)
            Text(envelope.title).font(Theme.body(15)).fontWeight(.semibold).foregroundStyle(Theme.text)
            Spacer()
            statusBadge
        }
    }

    @ViewBuilder private var statusBadge: some View {
        switch envelope.status {
        case "NEEDS_APPROVAL": badge("Needs approval", Theme.warn)
        case "DEGRADED": badge("Degraded", Theme.textFaint)
        case "FAILED": badge("Failed", Theme.danger)
        default: EmptyView()
        }
    }

    private func badge(_ t: String, _ c: Color) -> some View {
        Text(t).font(Theme.body(11)).foregroundStyle(c)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(c.opacity(0.12), in: Capsule())
    }

    private func fieldGrid(_ fields: [RenderEnvelope.KV]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(fields, id: \.label) { f in
                HStack(alignment: .top) {
                    Text(f.label).font(Theme.body(12)).foregroundStyle(Theme.textFaint).frame(width: 110, alignment: .leading)
                    Text(f.value).font(Theme.body(12)).foregroundStyle(Theme.text)
                    Spacer()
                }
            }
        }
    }

    private func itemRow(_ item: RenderEnvelope.Item) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.title).font(Theme.body(13)).fontWeight(.medium).foregroundStyle(Theme.text)
            if let s = item.subtitle { Text(s).font(Theme.body(12)).foregroundStyle(Theme.textDim) }
            if let fs = item.fields, !fs.isEmpty {
                Text(fs.map { "\($0.label): \($0.value)" }.joined(separator: " · "))
                    .font(Theme.body(11)).foregroundStyle(Theme.textFaint)
            }
            if let links = item.links { HStack { ForEach(links, id: \.url) { linkChip($0) } } }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func linkChip(_ l: RenderEnvelope.Link) -> some View {
        Button { if let u = URL(string: l.url) { openURL(u) } } label: {
            Text(l.label).font(Theme.body(12)).foregroundStyle(Theme.accent)
        }
    }

    private func actionRow(_ actions: [RenderEnvelope.Action]) -> some View {
        HStack {
            ForEach(actions) { a in
                Button { onApprove?(a) } label: {
                    Text(a.label).font(Theme.body(13)).fontWeight(.medium)
                        .foregroundStyle(a.style == "PRIMARY" || a.style == "DESTRUCTIVE" ? Theme.accentInk : Theme.text)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(a.style == "DESTRUCTIVE" ? Theme.danger : a.style == "PRIMARY" ? Theme.accent : Theme.surface3, in: Capsule())
                }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        if let attr = envelope.attribution, !attr.isEmpty {
            Text(attr.map { $0.label }.joined(separator: " · ") + (envelope.freshness.map { " · \($0)" } ?? ""))
                .font(Theme.body(10)).foregroundStyle(Theme.textFaint)
        }
    }

    private var icon: String {
        switch envelope.renderer {
        case "MAP": return "map"
        case "WEATHER": return "cloud.sun"
        case "SCHEDULE": return "calendar"
        case "ITINERARY": return "list.bullet.rectangle"
        case "APPROVAL": return "checkmark.shield"
        case "RECEIPT": return "checkmark.seal"
        case "LIST": return "list.bullet"
        default: return "sparkles"
        }
    }
}
