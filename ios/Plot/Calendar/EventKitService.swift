import Foundation
import EventKit

/// Reads the device calendar and maps events to BUSY INTERVALS ONLY before anything leaves the
/// device (PRD §13: calendars store busy/free, never titles/details). The mapping here drops every
/// field except start/end, so even a future upload path cannot leak event content.
public struct BusyInterval: Codable, Sendable {
    public let startsAt: Date
    public let endsAt: Date
}

public final class EventKitService {
    private let store = EKEventStore()

    public init() {}

    public func requestAccess() async -> Bool {
        await withCheckedContinuation { cont in
            if #available(iOS 17.0, *) {
                store.requestFullAccessToEvents { granted, _ in cont.resume(returning: granted) }
            } else {
                store.requestAccess(to: .event) { granted, _ in cont.resume(returning: granted) }
            }
        }
    }

    /// Busy intervals in [from, to]. Title/notes/location are intentionally never read.
    public func busyIntervals(from: Date, to: Date) -> [BusyInterval] {
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
        return store.events(matching: predicate)
            .filter { !$0.isAllDay && $0.availability != .free }
            .map { BusyInterval(startsAt: $0.startDate, endsAt: $0.endDate) } // ← only times survive
    }

    // TODO: REAL CREDENTIAL/ENDPOINT — POST busyIntervals to /me/availability so the server-side
    // CalendarProvider reflects this device's free/busy. The slice seeds availability instead.
}
