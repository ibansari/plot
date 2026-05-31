import Foundation
import Observation

/// Loads travel feasibility for a planning query and exposes group-visible scored candidates.
/// Holds NO member origins — only named ETAs returned by the API. (Spec §Native Maps Product Flow.)
@Observable
final class PlanMapViewModel {
    let groupId: String
    var planId: String?
    var query: String

    var candidates: [ScoredCandidate] = []
    var selectedId: String?
    var status: String = ""
    var loading = false
    var attribution: [FeasibilityResult.Attribution] = []

    init(groupId: String, query: String, planId: String? = nil) {
        self.groupId = groupId
        self.query = query
        self.planId = planId
    }

    var selected: ScoredCandidate? { candidates.first { $0.id == selectedId } }

    func load() async {
        loading = true; status = ""
        do {
            let res = try await APIClient.shared.mapsFeasibility(groupId: groupId, query: query, planId: planId, near: nil)
            candidates = res.candidates.filter { !$0.removed }
            attribution = res.attribution
            selectedId = candidates.first?.id
            if res.status == "DEGRADED" { status = res.reason ?? "Travel times unavailable" }
        } catch {
            status = "Couldn't load map: \(error.localizedDescription)"
        }
        loading = false
    }
}
