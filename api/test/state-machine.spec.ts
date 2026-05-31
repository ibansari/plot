import { PlanState } from "@plot/db";
import { nextState, canTransition, IllegalTransitionError } from "../src/plan/plan.statemachine";

// PRD §10 — the plan state machine. Pure transition tests (no DB).
describe("plan state machine (§10)", () => {
  it("walks the happy path DRAFT → PROPOSED → VOTING → LOCKED", () => {
    expect(nextState(PlanState.DRAFT, "propose")).toBe(PlanState.PROPOSED);
    expect(nextState(PlanState.PROPOSED, "openVoting")).toBe(PlanState.VOTING);
    expect(nextState(PlanState.VOTING, "lock")).toBe(PlanState.LOCKED);
  });

  it("LOCKED is a valid resolution; booking is optional", () => {
    expect(canTransition(PlanState.LOCKED, "book")).toBe(true);
    expect(nextState(PlanState.LOCKED, "book")).toBe(PlanState.BOOKED);
  });

  it("LOCKED can be unlocked back to VOTING (compensating action for auto-lock)", () => {
    expect(nextState(PlanState.LOCKED, "unlock")).toBe(PlanState.VOTING);
  });

  it("rejects illegal transitions", () => {
    expect(() => nextState(PlanState.DRAFT, "lock")).toThrow(IllegalTransitionError);
    expect(() => nextState(PlanState.LOCKED, "openVoting")).toThrow(IllegalTransitionError);
    expect(() => nextState(PlanState.CANCELLED, "propose")).toThrow(IllegalTransitionError);
    expect(() => nextState(PlanState.BOOKED, "lock")).toThrow(IllegalTransitionError);
  });

  it("allows cancel from any non-terminal state", () => {
    for (const s of [PlanState.DRAFT, PlanState.PROPOSED, PlanState.VOTING]) {
      expect(nextState(s, "cancel")).toBe(PlanState.CANCELLED);
    }
    expect(canTransition(PlanState.CANCELLED, "cancel")).toBe(false);
  });
});
