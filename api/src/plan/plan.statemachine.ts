import { PlanState } from "@plot/db";

// PRD §10 — the ONLY legal transitions. Enforced by assertTransition(); covered by tests.
export type PlanEvent = "propose" | "openVoting" | "lock" | "book" | "unlock" | "cancel";

const TRANSITIONS: Record<PlanState, Partial<Record<PlanEvent, PlanState>>> = {
  [PlanState.DRAFT]: { propose: PlanState.PROPOSED, cancel: PlanState.CANCELLED },
  [PlanState.PROPOSED]: { openVoting: PlanState.VOTING, cancel: PlanState.CANCELLED },
  [PlanState.VOTING]: { lock: PlanState.LOCKED, cancel: PlanState.CANCELLED },
  [PlanState.LOCKED]: { book: PlanState.BOOKED, unlock: PlanState.VOTING },
  [PlanState.BOOKED]: {},
  [PlanState.CANCELLED]: {},
};

export class IllegalTransitionError extends Error {
  constructor(from: PlanState, event: PlanEvent) {
    super(`illegal transition: cannot '${event}' from ${from}`);
  }
}

export function nextState(from: PlanState, event: PlanEvent): PlanState {
  const to = TRANSITIONS[from]?.[event];
  if (!to) throw new IllegalTransitionError(from, event);
  return to;
}

export function canTransition(from: PlanState, event: PlanEvent): boolean {
  return !!TRANSITIONS[from]?.[event];
}
