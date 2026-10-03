import { OrderStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  IllegalOrderTransitionError,
  allOrderStatuses,
  assertLegalTransition,
  isLegalTransition,
} from "./order-state-machine.js";

const LEGAL_PAIRS: Array<[OrderStatus, OrderStatus]> = [
  [OrderStatus.created, OrderStatus.payment_pending],
  [OrderStatus.created, OrderStatus.cancelled],
  [OrderStatus.payment_pending, OrderStatus.paid],
  [OrderStatus.payment_pending, OrderStatus.cod_confirmed],
  [OrderStatus.payment_pending, OrderStatus.cancelled],
  [OrderStatus.paid, OrderStatus.fulfilled],
  [OrderStatus.cod_confirmed, OrderStatus.fulfilled],
  [OrderStatus.fulfilled, OrderStatus.delivered],
  [OrderStatus.fulfilled, OrderStatus.rto],
];

describe("order state machine", () => {
  it.each(LEGAL_PAIRS)("allows %s -> %s", (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
    expect(() => assertLegalTransition(from, to)).not.toThrow();
  });

  // Every (from, to) pair not in LEGAL_PAIRS must be illegal — this is the "table test
  // covering every legal and illegal transition" the stage explicitly asks for: rather
  // than hand-picking a few illegal examples, it enumerates the full from x to matrix.
  const allPairs = allOrderStatuses().flatMap((from) =>
    allOrderStatuses().map((to): [OrderStatus, OrderStatus] => [from, to]),
  );
  const legalSet = new Set(LEGAL_PAIRS.map(([f, t]) => `${f}->${t}`));
  const illegalPairs = allPairs.filter(([f, t]) => !legalSet.has(`${f}->${t}`));

  it("covers every status pair exactly once between the legal and illegal sets", () => {
    expect(legalSet.size + illegalPairs.length).toBe(allOrderStatuses().length ** 2);
  });

  it.each(illegalPairs)("rejects %s -> %s", (from, to) => {
    expect(isLegalTransition(from, to)).toBe(false);
    expect(() => assertLegalTransition(from, to)).toThrow(IllegalOrderTransitionError);
  });

  it("terminal states (delivered, rto, cancelled) have no legal outgoing transitions", () => {
    for (const terminal of [OrderStatus.delivered, OrderStatus.rto, OrderStatus.cancelled]) {
      for (const to of allOrderStatuses()) {
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });
});
