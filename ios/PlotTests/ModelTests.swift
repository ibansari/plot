import XCTest
@testable import Plot

final class ModelTests: XCTestCase {
    func testPlanDecodesAndTalliesLookup() throws {
        let json = """
        {"id":"p1","title":"Dinner — friday","state":"VOTING","spendCapCents":5000,"spentCents":0,
         "options":[{"id":"o1","kind":"COMBO","label":"Fri 7:30p @ Ananda Thai","priceTier":2}],
         "votes":[{"optionId":"o1","up":3,"down":0}],
         "rsvps":[{"name":"Maya","status":"YES"}],
         "bringList":[{"id":"b1","label":"Cash for the table","generated":true}]}
        """.data(using: .utf8)!
        let plan = try JSONDecoder().decode(Plan.self, from: json)
        XCTAssertEqual(plan.state, .VOTING)
        XCTAssertEqual(plan.tally("o1")?.up, 3)
        XCTAssertEqual(plan.bringList.first?.label, "Cash for the table")
    }

    func testAgentMessageIsRecognized() throws {
        let m = Message(id: "m1", threadId: "t", kind: .DECISION_CARD, body: "✦", authorId: nil,
                        authorName: "Plot", planId: "p1", createdAt: "2026-06-01T18:00:00Z")
        XCTAssertTrue(m.isAgent)
    }
}
