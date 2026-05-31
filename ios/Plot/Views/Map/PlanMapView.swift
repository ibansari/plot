import SwiftUI
import MapKit

/// Group travel map: candidate venue pins + the selected venue's per-member ETAs and fairness.
/// It NEVER shows member home/origin pins — only venues. (Spec §Chat and iOS UI, privacy rule.)
/// Uses MapKit so the slice builds with no extra SDK; the Google Maps SDK is the documented swap.
struct PlanMapView: View {
    @Bindable var vm: PlanMapViewModel
    var onAddToDraft: ((ScoredCandidate) -> Void)? = nil
    @Environment(\.openURL) private var openURL
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        VStack(spacing: 0) {
            Map(position: $camera) {
                ForEach(vm.candidates) { c in
                    if let loc = c.venue.location {
                        Annotation(c.venue.name, coordinate: .init(latitude: loc.lat, longitude: loc.lng)) {
                            Button { vm.selectedId = c.id } label: {
                                Image(systemName: vm.selectedId == c.id ? "mappin.circle.fill" : "mappin.circle")
                                    .font(.title2).foregroundStyle(c.id == vm.selectedId ? Theme.accent : Theme.pop)
                            }
                        }
                    }
                }
            }
            .frame(height: 280)

            detailPanel
        }
        .overlay(alignment: .top) { if vm.loading { ProgressView().padding(8) } }
        .task { await vm.load() }
    }

    @ViewBuilder private var detailPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !vm.status.isEmpty {
                    Text(vm.status).font(Theme.body(12)).foregroundStyle(Theme.textDim)
                }
                if let c = vm.selected {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(c.venue.name).font(Theme.body(17)).fontWeight(.semibold).foregroundStyle(Theme.text)
                            Spacer()
                            if let p = c.venue.priceTier { Text(String(repeating: "$", count: p)).font(Theme.body(13)).foregroundStyle(Theme.textDim) }
                        }
                        if let a = c.venue.address { Text(a).font(Theme.body(12)).foregroundStyle(Theme.textDim) }
                        travelRow(c.travel)
                        ForEach(c.travel.namedEtas) { eta in etaRow(eta) }
                        HStack(spacing: 10) {
                            Button("Add to draft") { onAddToDraft?(c) }
                                .font(Theme.body(14)).fontWeight(.medium).foregroundStyle(Theme.accentInk)
                                .padding(.horizontal, 16).padding(.vertical, 9).background(Theme.accent, in: Capsule())
                            Button("Open in Google Maps") {
                                if let loc = c.venue.location, let u = URL(string: "https://www.google.com/maps/search/?api=1&query=\(loc.lat),\(loc.lng)") { openURL(u) }
                            }
                            .font(Theme.body(14)).foregroundStyle(Theme.text)
                            .padding(.horizontal, 16).padding(.vertical, 9).background(Theme.surface3, in: Capsule())
                        }
                    }
                    .padding(14).background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                }
                if !vm.attribution.isEmpty {
                    Text(vm.attribution.map { $0.label }.joined(separator: " · ")).font(Theme.body(10)).foregroundStyle(Theme.textFaint)
                }
            }
            .padding(16)
        }
    }

    private func travelRow(_ t: TravelSummary) -> some View {
        HStack(spacing: 12) {
            if let m = t.medianEtaMin { label("median", "\(m)m") }
            if let mx = t.maxEtaMin { label("max", "\(mx)m") }
            if t.softWarnings > 0 { label("warnings", "\(t.softWarnings)", Theme.warn) }
            Spacer()
            Text("fairness \(Int(t.fairnessScore))").font(Theme.body(11)).foregroundStyle(Theme.textFaint)
        }
    }

    private func label(_ k: String, _ v: String, _ c: Color = Theme.text) -> some View {
        HStack(spacing: 3) { Text(k).foregroundStyle(Theme.textFaint); Text(v).foregroundStyle(c) }.font(Theme.body(11))
    }

    private func etaRow(_ eta: NamedEta) -> some View {
        HStack {
            Circle().fill(color(for: eta.guardrail)).frame(width: 7, height: 7)
            Text(eta.name).font(Theme.body(13)).foregroundStyle(Theme.text)
            Spacer()
            Text(eta.durationMin.map { "\($0) min" } ?? "—").font(Theme.body(13)).foregroundStyle(Theme.textDim)
            Text(eta.mode.lowercased()).font(Theme.body(10)).foregroundStyle(Theme.textFaint)
        }
    }

    private func color(for g: String) -> Color {
        switch g { case "HARD": return Theme.danger; case "SOFT": return Theme.warn; case "OK": return Theme.accent; default: return Theme.textFaint }
    }
}
