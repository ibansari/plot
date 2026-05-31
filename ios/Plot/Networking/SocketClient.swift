import Foundation

/// Live state over `URLSessionWebSocketTask`, speaking the Engine.IO v4 / Socket.IO framing the
/// NestJS gateway uses. Minimal but real: handles open(0), ns-connect(40), ping(2)/pong(3), and
/// event(42) frames. Emits decoded payloads for chat, plan, and audit updates.
public final class SocketClient: NSObject, @unchecked Sendable {
    public enum Event { case message(Message), messageUpdated(Message), planUpdated(Plan), auditCreated(AuditEntry) }

    private var task: URLSessionWebSocketTask?
    private let base: String
    private let threadId: String
    private let onEvent: @Sendable (Event) -> Void

    public init(baseURL: String = ProcessInfo.processInfo.environment["PLOT_API_BASE_URL"] ?? "http://localhost:3000",
                threadId: String,
                onEvent: @escaping @Sendable (Event) -> Void) {
        // ws(s)://host/socket.io/?EIO=4&transport=websocket
        self.base = baseURL.replacingOccurrences(of: "http", with: "ws")
        self.threadId = threadId
        self.onEvent = onEvent
    }

    public func connect() {
        guard let url = URL(string: "\(base)/socket.io/?EIO=4&transport=websocket") else { return }
        task = URLSession.shared.webSocketTask(with: url)
        task?.resume()
        receive()
    }

    public func disconnect() { task?.cancel(with: .goingAway, reason: nil) }

    private func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            if case .success(let msg) = result, case .string(let text) = msg {
                self.handle(text)
                self.receive()
            }
        }
    }

    private func handle(_ text: String) {
        // Engine.IO packet types are the leading digit(s).
        if text.hasPrefix("0") {           // open → connect to default namespace
            send("40")
        } else if text == "2" {            // ping → pong
            send("3")
        } else if text.hasPrefix("40") {   // ns connected → join our thread room
            let payload = "[\"join\",{\"threadId\":\"\(threadId)\"}]"
            send("42\(payload)")
        } else if text.hasPrefix("42") {   // event
            decodeEvent(String(text.dropFirst(2)))
        }
    }

    private func decodeEvent(_ json: String) {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let name = arr.first as? String, arr.count > 1,
              let payload = try? JSONSerialization.data(withJSONObject: arr[1]) else { return }
        let dec = JSONDecoder()
        switch name {
        case "message.created":
            if let m = try? dec.decode(Message.self, from: payload) { onEvent(.message(m)) }
        case "message.updated":
            if let m = try? dec.decode(Message.self, from: payload) { onEvent(.messageUpdated(m)) }
        case "plan.updated":
            if let p = try? dec.decode(Plan.self, from: payload) { onEvent(.planUpdated(p)) }
        case "audit.created":
            if let a = try? dec.decode(AuditEntry.self, from: payload) { onEvent(.auditCreated(a)) }
        default: break
        }
    }
}
