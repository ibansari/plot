import Foundation

/// Thin async REST client over URLSession. Equivalent to the generated OpenAPI client; checked in
/// so the slice compiles with no SPM dependencies. Base URL points at the NestJS API.
public actor APIClient {
    public static let shared = APIClient()

    private let base: URL
    private var token: String?

    public init(baseURL: String = ProcessInfo.processInfo.environment["PLOT_API_BASE_URL"] ?? "http://localhost:3000") {
        self.base = URL(string: baseURL)!
    }

    public func setToken(_ t: String?) { self.token = t }

    // MARK: - Auth
    public func startOtp(phone: String) async throws -> OtpStartResponse {
        try await post("/auth/otp/start", body: ["phone": phone])
    }
    public func verifyOtp(phone: String, code: String) async throws -> Session {
        let s: Session = try await post("/auth/otp/verify", body: ["phone": phone, "code": code])
        token = s.token
        return s
    }
    public func signInWithApple(identityToken: String, displayName: String?) async throws -> Session {
        var body: [String: String] = ["identityToken": identityToken]
        if let displayName { body["displayName"] = displayName }
        let s: Session = try await post("/auth/apple", body: body)
        token = s.token
        return s
    }
    public func me() async throws -> User { try await get("/me") }

    // MARK: - Groups
    public func myGroups() async throws -> [GroupSummary] { try await get("/me/groups") }
    public func createGroup(name: String) async throws -> GroupDetail {
        try await post("/groups", body: ["name": name])
    }
    public func group(_ id: String) async throws -> GroupDetail { try await get("/groups/\(id)") }
    public func addMember(groupId: String, phone: String, displayName: String, asNonUser: Bool) async throws -> GroupDetail {
        try await post("/groups/\(groupId)/members", body: AddMemberBody(phone: phone, displayName: displayName, asNonUser: asNonUser))
    }

    // MARK: - Me (settings / sync)
    public func syncAvailability(_ intervals: [BusyInterval]) async throws {
        struct Body: Encodable { let intervals: [Interval]; struct Interval: Encodable { let startsAt: String; let endsAt: String } }
        let iso = ISO8601DateFormatter()
        let payload = Body(intervals: intervals.map { .init(startsAt: iso.string(from: $0.startsAt), endsAt: iso.string(from: $0.endsAt)) })
        let _: EmptyResponse = try await post("/me/availability", body: payload)
    }
    public func registerDevice(apnsToken: String) async throws {
        let _: EmptyResponse = try await post("/me/devices", body: ["apnsToken": apnsToken])
    }
    public func permissions(groupId: String? = nil) async throws -> [PermissionDTO] {
        try await get("/me/permissions" + (groupId.map { "?groupId=\($0)" } ?? ""))
    }
    public func setPermission(scope: String, granted: Bool, groupId: String? = nil) async throws {
        struct Body: Encodable { let scope: String; let granted: Bool; let groupId: String? }
        let _: EmptyResponse = try await put("/me/permissions", body: Body(scope: scope, granted: granted, groupId: groupId))
    }
    public func setSpendCap(cents: Int) async throws -> SpendCapResponse {
        try await put("/me/spend-cap", body: ["cents": cents])
    }

    // MARK: - Chat
    public func messages(threadId: String) async throws -> [Message] {
        try await get("/threads/\(threadId)/messages")
    }
    public func postMessage(threadId: String, body: String) async throws -> Message {
        try await post("/threads/\(threadId)/messages", body: ["body": body])
    }
    public func actOnPlotSuggestion(threadId: String, messageId: String, action: String) async throws -> Message {
        try await post("/threads/\(threadId)/plot-suggestions/\(messageId)/actions", body: ["action": action])
    }

    // MARK: - Plan
    public func plan(_ id: String) async throws -> Plan { try await get("/plans/\(id)") }
    public func startVote(planId: String) async throws -> Plan {
        try await post("/plans/\(planId)/start-vote", body: [String: String]())
    }
    public func addOption(planId: String, label: String) async throws -> Plan {
        try await post("/plans/\(planId)/options", body: ["kind": "ACTIVITY", "label": label])
    }
    public func removeOption(planId: String, optionId: String) async throws -> Plan {
        try await delete("/plans/\(planId)/options/\(optionId)")
    }
    public func vote(planId: String, optionId: String, value: String = "UP") async throws -> Plan {
        try await post("/plans/\(planId)/votes", body: ["optionId": optionId, "value": value])
    }
    public func rsvp(planId: String, status: String) async throws -> Plan {
        try await post("/plans/\(planId)/rsvp", body: ["status": status])
    }
    public func audit(planId: String) async throws -> [AuditEntry] {
        try await get("/plans/\(planId)/audit")
    }
    public func book(planId: String) async throws -> Plan {
        // book then return the refreshed plan (the response is a booking result; re-read the plan)
        let _: BookResult = try await post("/plans/\(planId)/book", body: [String: String]())
        return try await plan(planId)
    }
    public func enactContingency(planId: String, index: Int) async throws -> Plan {
        try await post("/plans/\(planId)/contingencies/\(index)/enact", body: [String: String]())
    }
    public func split(planId: String) async throws -> SplitDTO? {
        // GET returns null when there's no split → decode leniently
        do { return try await get("/plans/\(planId)/split") } catch { return nil }
    }
    public func paySplit(splitId: String) async throws -> SplitDTO {
        try await post("/splits/\(splitId)/pay", body: [String: String]())
    }
    public func undo(auditId: String) async throws -> UndoResult {
        try await post("/audit/\(auditId)/undo", body: [String: String]())
    }

    // MARK: - transport
    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET", body: Optional<[String: String]>.none)
    }
    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "POST", body: body)
    }
    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path, method: "PUT", body: body)
    }
    private func delete<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "DELETE", body: Optional<[String: String]>.none)
    }
    private func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B?) async throws -> T {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONEncoder().encode(body) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http(String(data: data, encoding: .utf8) ?? "request failed")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

public struct OtpStartResponse: Codable { public let sent: Bool; public var devHint: String? }
public struct UndoResult: Codable { public let ok: Bool; public let action: String; public var detail: String? }
public struct SpendCapResponse: Codable { public let defaultSpendCapCents: Int }
public struct BookResult: Codable { public var booked: Bool?; public var confirmation: String? }
public struct EmptyResponse: Codable {}
struct AddMemberBody: Encodable { let phone: String; let displayName: String; let asNonUser: Bool }

public enum APIError: Error { case http(String) }
