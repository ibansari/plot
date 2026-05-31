import Foundation

/// Codable models mirroring openapi/openapi.yaml. (The generated client produces equivalents;
/// these are checked in so the slice compiles with zero SPM dependencies.)

public struct Session: Codable {
    public let token: String
    public let user: User
}

public struct User: Codable, Identifiable, Hashable {
    public let id: String
    public let displayName: String
    public var phone: String?
    public var avatarUrl: String?
    public var defaultSpendCapCents: Int?
}

public enum MessageKind: String, Codable {
    case TEXT, SYSTEM, AGENT, DECISION_CARD
}

public struct MessageMetadata: Codable, Hashable {
    public var kind: String?
    public var status: String?
    public var actions: [String]?
}

public struct Message: Codable, Identifiable, Hashable {
    public let id: String
    public let threadId: String
    public let kind: MessageKind
    public let body: String
    public var authorId: String?
    public var authorName: String?
    public var planId: String?
    public var metadata: MessageMetadata?
    public var createdAt: String

    public var isAgent: Bool { kind == .AGENT || kind == .DECISION_CARD }
}

public enum PlanState: String, Codable {
    case DRAFT, PROPOSED, VOTING, LOCKED, BOOKED, CANCELLED
}

public enum OptionKind: String, Codable {
    case TIME, PLACE, COMBO, ACTIVITY
}

public struct PlanOption: Codable, Identifiable, Hashable {
    public let id: String
    public let kind: OptionKind
    public let label: String
    public var startsAt: String?
    public var endsAt: String?
    public var place: String?
    public var priceTier: Int?
    public var why: String?          // Plot's "why it fits this group" line (§A2)
    public var fitFlags: [String]?   // surfaced caveats for a poor fit
}

public struct BookingFallback: Codable, Hashable {
    public let kind: String  // "call" | "link"
    public let value: String
    public let label: String
}

public struct SplitShareDTO: Codable, Hashable {
    public let name: String
    public let amountCents: Int
    public let paid: Bool
    public let isNonUser: Bool
}

public struct SplitDTO: Codable, Hashable {
    public var id: String
    public let state: String
    public let totalCents: Int
    public var memo: String?
    public var shares: [SplitShareDTO]
}

public struct Contingency: Codable, Hashable {
    public let ifText: String
    public let thenText: String
    public let type: String
    public var backupOptionId: String?
}

public struct VoteTally: Codable, Hashable {
    public let optionId: String
    public let up: Int
    public let down: Int
}

public struct ViewerVote: Codable, Hashable {
    public let optionId: String
    public let value: String
}

public struct RsvpEntry: Codable, Hashable {
    public let name: String
    public let status: String
}

public struct BringItem: Codable, Identifiable, Hashable {
    public let id: String
    public let label: String
    public let generated: Bool
}

public struct Plan: Codable, Identifiable, Hashable {
    public let id: String
    public let title: String
    public let state: PlanState
    public var lockedOptionId: String?
    public var lockedTime: String?
    public var lockedPlace: String?
    public var softDeadline: String?
    public var spendCapCents: Int
    public var spentCents: Int
    public var options: [PlanOption]
    public var votes: [VoteTally]
    public var viewerVote: ViewerVote?
    public var viewerRsvp: String?
    public var rsvps: [RsvpEntry]
    public var bringList: [BringItem]
    public var bookingRef: String?
    public var bookingFallback: BookingFallback?
    public var split: SplitDTO?
    public var contingencies: [Contingency]?

    public func tally(_ optionId: String) -> VoteTally? { votes.first { $0.optionId == optionId } }
}

// ── Groups (real, data-driven) ──

public struct GroupSummary: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public var threadId: String?
    public var memberNames: [String]
    public var lastMessage: LastMessage?
    public var activePlan: ActivePlan?
    public var needsYou: Bool

    public struct LastMessage: Codable, Hashable { public let body: String; public let isAgent: Bool }
    public struct ActivePlan: Codable, Hashable { public let id: String; public let title: String; public let state: String }
}

public struct GroupDetail: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public var threadId: String?
    public var members: [Member]
    public struct Member: Codable, Hashable {
        public let name: String
        public let role: String
        public let isNonUser: Bool
        public var phone: String?
    }
}

public struct PermissionDTO: Codable, Hashable {
    public let scope: String
    public let granted: Bool
    public var groupId: String?
}

public struct AuditEntry: Codable, Identifiable, Hashable {
    public let id: String
    public let actor: String
    public let action: String
    public let summary: String
    public var amountCents: Int
    public let undoable: Bool
    public var undoneAt: String?
    public let createdAt: String
}
