import { OrderStatus, type Order } from "@prisma/client";

const IST_OFFSET_MINUTES = 5 * 60 + 30; // IST is a fixed UTC+5:30, no DST.

/** IST calendar-day bucket key (YYYY-MM-DD), computed by shifting the UTC timestamp by
 * the fixed IST offset before reading its date parts — avoids pulling in a timezone
 * library for a single fixed, no-DST offset. */
export function istDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export interface DailyMetrics {
  date: string;
  ordersCreated: number;
  paidOrCodConfirmed: number;
  delivered: number;
  rto: number;
  conversionRate: number;
  rtoRate: number;
}

const CONVERTED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.paid,
  OrderStatus.cod_confirmed,
  OrderStatus.fulfilled,
  OrderStatus.delivered,
]);

/** Pure function over an already-fetched order list — the caller owns the DB query and
 * the merchant-scoping; this just buckets by IST calendar day and computes the two rates
 * the master prompt asked for. `conversionRate` = converted / created for orders created
 * that day; `rtoRate` = rto / (delivered + rto) for orders that *reached* a terminal
 * delivery outcome that day (orders still in flight don't count against or for it yet). */
export function computeDailyMetrics(orders: Pick<Order, "status" | "createdAt">[]): DailyMetrics[] {
  const byDay = new Map<
    string,
    { created: number; converted: number; delivered: number; rto: number }
  >();

  for (const order of orders) {
    const key = istDateKey(order.createdAt);
    const bucket = byDay.get(key) ?? { created: 0, converted: 0, delivered: 0, rto: 0 };
    bucket.created += 1;
    if (CONVERTED_STATUSES.has(order.status)) bucket.converted += 1;
    if (order.status === OrderStatus.delivered) bucket.delivered += 1;
    if (order.status === OrderStatus.rto) bucket.rto += 1;
    byDay.set(key, bucket);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => {
      const deliveryOutcomes = bucket.delivered + bucket.rto;
      return {
        date,
        ordersCreated: bucket.created,
        paidOrCodConfirmed: bucket.converted,
        delivered: bucket.delivered,
        rto: bucket.rto,
        conversionRate: bucket.created === 0 ? 0 : bucket.converted / bucket.created,
        rtoRate: deliveryOutcomes === 0 ? 0 : bucket.rto / deliveryOutcomes,
      };
    });
}
