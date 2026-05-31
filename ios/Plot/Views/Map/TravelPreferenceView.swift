import SwiftUI
import CoreLocation

/// Member sets a private starting area + travel guardrails. The typed area is geocoded locally
/// (CLGeocoder — no key) into coordinates that are sent once and stored encrypted server-side; the
/// group only ever sees the member's named ETA, never this address. (Spec §Member Origin Setup.)
/// In production this is Google Places autocomplete; CLGeocoder keeps the slice buildable.
struct TravelPreferenceView: View {
    let groupId: String
    @Environment(\.dismiss) private var dismiss

    @State private var area = ""
    @State private var mode = "AUTO"
    @State private var softLimit = 45.0
    @State private var hardLimit = false
    @State private var saving = false
    @State private var status: String?

    private let modes = ["AUTO", "DRIVE", "TRANSIT", "WALK", "BICYCLE"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Where you usually start") {
                    TextField("Neighborhood or address", text: $area)
                        .textInputAutocapitalization(.words)
                    Text("Kept private — the group only sees your travel time, never this location.")
                        .font(Theme.body(11)).foregroundStyle(Theme.textFaint)
                }
                Section("How you travel") {
                    Picker("Mode", selection: $mode) { ForEach(modes, id: \.self) { Text($0.capitalized) } }
                }
                Section("Travel limit") {
                    HStack { Text("Max \(Int(softLimit)) min"); Spacer() }
                    Slider(value: $softLimit, in: 10...120, step: 5)
                    Toggle("Hard limit (remove venues over this)", isOn: $hardLimit)
                        .tint(Theme.accent)
                    Text(hardLimit ? "Plot drops venues you can't reach in time." : "Plot just warns when a venue is over your limit.")
                        .font(Theme.body(11)).foregroundStyle(Theme.textFaint)
                }
                if let status { Section { Text(status).font(Theme.body(12)).foregroundStyle(Theme.textDim) } }
            }
            .navigationTitle("Travel preferences")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save() }.disabled(saving || area.isEmpty)
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func save() {
        saving = true; status = nil
        Task {
            do {
                let placemarks = try await CLGeocoder().geocodeAddressString(area)
                guard let loc = placemarks.first?.location?.coordinate else {
                    status = "Couldn't find that place — try a more specific area."; saving = false; return
                }
                _ = try await APIClient.shared.saveTravelPreference(.init(
                    groupId: groupId,
                    location: .init(lat: loc.latitude, lng: loc.longitude),
                    savedPlaceId: nil, label: area, mode: mode,
                    softLimitMin: Int(softLimit), hardLimit: hardLimit,
                ))
                dismiss()
            } catch { status = "Save failed: \(error.localizedDescription)"; saving = false }
        }
    }
}
