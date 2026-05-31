import Foundation

// Client models for the MCP-first integrations spec (Slice 1 travel + Slice 2 render envelope).
// These mirror the API DTOs. Member origin COORDINATES never appear here — only named ETAs.

// MARK: - Travel / Maps (Slice 1)

public struct NamedEta: Codable, Identifiable, Hashable {
    public var id: String { name }
    public let name: String
    public let mode: String
    public let durationMin: Int?
    public let guardrail: String   // OK | SOFT | HARD | UNKNOWN
}

public struct TravelSummary: Codable, Hashable {
    public let medianEtaMin: Int?
    public let maxEtaMin: Int?
    public let spreadMin: Int?
    public let fairnessScore: Double
    public let softWarnings: Int
    public let hardFailures: Int
    public let namedEtas: [NamedEta]
}

public struct CandidateVenue: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let address: String?
    public struct Loc: Codable, Hashable { public let lat: Double; public let lng: Double }
    public let location: Loc?
    public let priceTier: Int?
}

public struct ScoredCandidate: Codable, Identifiable, Hashable {
    public var id: String { venue.id }
    public let venue: CandidateVenue
    public let travel: TravelSummary
    public let removed: Bool
    public let removalReason: String?
}

public struct FeasibilityResult: Codable {
    public let status: String        // READY | DEGRADED
    public let reason: String?
    public let candidates: [ScoredCandidate]
    public struct Attribution: Codable, Hashable { public let label: String; public let url: String? }
    public let attribution: [Attribution]
}

public struct TravelPreferenceBody: Encodable {
    public let groupId: String
    public let location: CandidateVenue.Loc
    public var savedPlaceId: String?
    public var label: String?
    public var mode: String?         // DRIVE | TRANSIT | WALK | BICYCLE | AUTO
    public var softLimitMin: Int?
    public var hardLimit: Bool?
}

// MARK: - MCP render envelope (Slice 2)

public struct RenderEnvelope: Codable, Identifiable, Hashable {
    public let id: String
    public let serverId: String
    public let toolName: String
    public let renderer: String      // GENERIC | LIST | COMPARISON | MAP | WEATHER | SCHEDULE | ITINERARY | APPROVAL | RECEIPT
    public let title: String
    public let summary: String?
    public let freshness: String?
    public struct KV: Codable, Hashable { public let label: String; public let value: String }
    public struct Link: Codable, Hashable { public let label: String; public let url: String }
    public struct Item: Codable, Hashable, Identifiable {
        public var id: String { (idField ?? title) }
        private let idField: String?
        public let title: String
        public let subtitle: String?
        public let fields: [KV]?
        public let links: [Link]?
        enum CodingKeys: String, CodingKey { case idField = "id", title, subtitle, fields, links }
    }
    public struct Action: Codable, Hashable, Identifiable {
        public let id: String
        public let label: String
        public let style: String     // PRIMARY | SECONDARY | DESTRUCTIVE
        public let approvalId: String?
    }
    public let attribution: [FeasibilityResult.Attribution]?
    public let fields: [KV]?
    public let items: [Item]?
    public let links: [Link]?
    public let actions: [Action]?
    public let risk: String?         // READ | WRITE | HOLD | PURCHASE | IRREVERSIBLE
    public let status: String        // READY | DEGRADED | NEEDS_APPROVAL | FAILED
}

public struct ConnectorEntry: Codable, Identifiable, Hashable {
    public var id: String { key }
    public let key: String
    public let displayName: String
    public let category: String
    public let trustTier: String
    public let sourceUrl: String?
}
