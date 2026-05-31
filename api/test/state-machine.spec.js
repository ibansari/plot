"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("@plot/db");
const plan_statemachine_1 = require("../src/plan/plan.statemachine");
// PRD §10 — the plan state machine. Pure transition tests (no DB).
describe("plan state machine (§10)", () => {
    it("walks the happy path DRAFT → PROPOSED → VOTING → LOCKED", () => {
        expect((0, plan_statemachine_1.nextState)(db_1.PlanState.DRAFT, "propose")).toBe(db_1.PlanState.PROPOSED);
        expect((0, plan_statemachine_1.nextState)(db_1.PlanState.PROPOSED, "openVoting")).toBe(db_1.PlanState.VOTING);
        expect((0, plan_statemachine_1.nextState)(db_1.PlanState.VOTING, "lock")).toBe(db_1.PlanState.LOCKED);
    });
    it("LOCKED is a valid resolution; booking is optional", () => {
        expect((0, plan_statemachine_1.canTransition)(db_1.PlanState.LOCKED, "book")).toBe(true);
        expect((0, plan_statemachine_1.nextState)(db_1.PlanState.LOCKED, "book")).toBe(db_1.PlanState.BOOKED);
    });
    it("LOCKED can be unlocked back to VOTING (compensating action for auto-lock)", () => {
        expect((0, plan_statemachine_1.nextState)(db_1.PlanState.LOCKED, "unlock")).toBe(db_1.PlanState.VOTING);
    });
    it("rejects illegal transitions", () => {
        expect(() => (0, plan_statemachine_1.nextState)(db_1.PlanState.DRAFT, "lock")).toThrow(plan_statemachine_1.IllegalTransitionError);
        expect(() => (0, plan_statemachine_1.nextState)(db_1.PlanState.LOCKED, "openVoting")).toThrow(plan_statemachine_1.IllegalTransitionError);
        expect(() => (0, plan_statemachine_1.nextState)(db_1.PlanState.CANCELLED, "propose")).toThrow(plan_statemachine_1.IllegalTransitionError);
        expect(() => (0, plan_statemachine_1.nextState)(db_1.PlanState.BOOKED, "lock")).toThrow(plan_statemachine_1.IllegalTransitionError);
    });
    it("allows cancel from any non-terminal state", () => {
        for (const s of [db_1.PlanState.DRAFT, db_1.PlanState.PROPOSED, db_1.PlanState.VOTING]) {
            expect((0, plan_statemachine_1.nextState)(s, "cancel")).toBe(db_1.PlanState.CANCELLED);
        }
        expect((0, plan_statemachine_1.canTransition)(db_1.PlanState.CANCELLED, "cancel")).toBe(false);
    });
});
