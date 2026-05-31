import SwiftUI
import Observation

@MainActor
@Observable
public final class GroupsViewModel {
    public var groups: [GroupSummary] = []
    public var loading = false
    public var error: String?

    private let api = APIClient.shared
    public init() {}

    public func load() async {
        loading = true
        do { groups = try await api.myGroups() }
        catch { self.error = "\(error)" }
        loading = false
    }

    public func create(name: String) async -> GroupSummary? {
        do {
            let detail = try await api.createGroup(name: name)
            await load()
            return groups.first { $0.id == detail.id }
        } catch { self.error = "\(error)"; return nil }
    }
}
