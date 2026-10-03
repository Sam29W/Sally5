import { OrderStatus } from "@prisma/client";

export class IllegalOrderTransitionError extends Error {}

/** Single source of truth for legal order transitions — see prisma/schema.prisma's
 * OrderStatus comment for the diagram. Terminal states (delivered, rto, cancelled) have
 * no outgoing edges at all. */
const LEGAL_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.created]: [OrderStatus.payment_pending, OrderStatus.cancelled],
  [OrderStatus.payment_pending]: [
    OrderStatus.paid,
    OrderStatus.cod_confirmed,
    OrderStatus.cancelled,
  ],
  [OrderStatus.paid]: [OrderStatus.fulfilled],
  [OrderStatus.cod_confirmed]: [OrderStatus.fulfilled],
  [OrderStatus.fulfilled]: [OrderStatus.delivered, OrderStatus.rto],
  [OrderStatus.delivered]: [],
  [OrderStatus.rto]: [],
  [OrderStatus.cancelled]: [],
};

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Throws IllegalOrderTransitionError if `to` is not reachable from `from`. */
export function assertLegalTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isLegalTransition(from, to)) {
    throw new IllegalOrderTransitionError(`Cannot transition order from ${from} to ${to}`);
  }
}

export function allOrderStatuses(): OrderStatus[] {
  return Object.values(OrderStatus);
}
