import SwiftUI
import Observation

@MainActor
@Observable
public final class ChatViewModel {
    public let threadId: String
    public let myUserId: String
    public var messages: [Message] = []
    public var plans: [String: Plan] = [:]   // planId → latest Plan (live)
    public var audits: [String: [AuditEntry]] = [:] // planId → audit log
    public var draft: String = ""
    public var error: String?

    private let api = APIClient.shared
    private var socket: SocketClient?

    public init(threadId: String = "t_crew", myUserId: String = "") {
        self.threadId = threadId
        self.myUserId = myUserId
    }

    public func start() async {
        await load()
        connectLive()
    }

    public func load() async {
        do {
            messages = try await api.messages(threadId: threadId)
            // hydrate any plans referenced by decision cards
            for m in messages where m.planId != nil {
                if let id = m.planId, plans[id] == nil {
                    plans[id] = try? await api.plan(id)
                }
            }
        } catch { self.error = "\(error)" }
    }

    private func connectLive() {
        socket = SocketClient(threadId: threadId) { [weak self] event in
            Task { @MainActor in self?.apply(event) }
        }
        socket?.connect()
    }

    private func apply(_ event: SocketClient.Event) {
        switch event {
        case .message(let m):
            if !messages.contains(where: { $0.id == m.id }) { messages.append(m) }
            if let id = m.planId { Task { plans[id] = try? await api.plan(id) } }
        case .messageUpdated(let m):
            if let index = messages.firstIndex(where: { $0.id == m.id }) { messages[index] = m }
        case .planUpdated(let p):
            var next = p
            next.viewerVote = next.viewerVote ?? plans[p.id]?.viewerVote
            next.viewerRsvp = next.viewerRsvp ?? plans[p.id]?.viewerRsvp
            plans[p.id] = next
        case .auditCreated:
            // an audit event means Plot acted on a plan (lock/book/undo/enact/split). Refresh both
            // the audit log AND the plan state — some compensating actions broadcast only an id,
            // so re-fetch the full plan to keep status/spend/booking current.
            for id in audits.keys { Task { await loadAudit(planId: id) } }
            for id in plans.keys { Task { plans[id] = try? await api.plan(id) } }
        }
    }

    public func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        draft = ""
        do { _ = try await api.postMessage(threadId: threadId, body: body) }
        catch { self.error = "\(error)" }
    }

    public func vote(planId: String, optionId: String, value: String = "UP") async {
        do { plans[planId] = try await api.vote(planId: planId, optionId: optionId, value: value) }
        catch { self.error = "\(error)" }
    }

    public func actOnSuggestion(messageId: String, action: String) async {
        do {
            let updated = try await api.actOnPlotSuggestion(threadId: threadId, messageId: messageId, action: action)
            if let index = messages.firstIndex(where: { $0.id == messageId }) { messages[index] = updated }
        } catch { self.error = "\(error)" }
    }

    public func startVote(planId: String) async {
        do { plans[planId] = try await api.startVote(planId: planId) }
        catch { self.error = "\(error)" }
    }

    public func addOption(planId: String, label: String) async {
        do { plans[planId] = try await api.addOption(planId: planId, label: label) }
        catch { self.error = "\(error)" }
    }

    public func removeOption(planId: String, optionId: String) async {
        do { plans[planId] = try await api.removeOption(planId: planId, optionId: optionId) }
        catch { self.error = "\(error)" }
    }

    public func rsvp(planId: String, status: String) async {
        do { plans[planId] = try await api.rsvp(planId: planId, status: status) }
        catch { self.error = "\(error)" }
    }

    public func book(planId: String) async {
        do { plans[planId] = try await api.book(planId: planId) }
        catch { self.error = "\(error)" }
    }

    public func enact(planId: String, index: Int) async {
        do { plans[planId] = try await api.enactContingency(planId: planId, index: index) }
        catch { self.error = "\(error)" }
    }

    public func paySplit(planId: String, splitId: String) async {
        do {
            _ = try await api.paySplit(splitId: splitId)
            plans[planId] = try await api.plan(planId)
        } catch { self.error = "\(error)" }
    }

    public func loadAudit(planId: String) async {
        do { audits[planId] = try await api.audit(planId: planId) }
        catch { self.error = "\(error)" }
    }

    public func undo(planId: String, auditId: String) async {
        do {
            _ = try await api.undo(auditId: auditId)
            await loadAudit(planId: planId)
            plans[planId] = try? await api.plan(planId)
        } catch { self.error = "\(error)" }
    }
}
