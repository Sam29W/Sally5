import { Inject, Injectable } from "@nestjs/common";
import type { AuditLog } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export interface RecordAuditLogInput {
  merchantId: string;
  /** MerchantUser id, when the actor authenticated via the dashboard. Null for the one
   * action (owner bootstrap) that happens before any MerchantUser exists yet. */
  actorId?: string | null;
  actorEmail?: string | null;
  /** Set instead of actorId/actorEmail when the actor proved itself with the merchant's
   * API key rather than a dashboard login (e.g. owner bootstrap). Only the prefix — never
   * the secret — same as everywhere else this codebase shows a key back to its owner. */
  actorApiKeyPrefix?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only by construction: this service exposes `record` and `listForMerchant`
 * only — no update, no delete, anywhere. See decision 011 for why that matters (an audit
 * trail a privileged actor could edit isn't one).
 */
@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        merchantId: input.merchantId,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorApiKeyPrefix: input.actorApiKeyPrefix ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        oldValue: toJson(input.oldValue),
        newValue: toJson(input.newValue),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  /** Scoped to `merchantId` — never returns another merchant's audit trail. */
  async listForMerchant(
    merchantId: string,
    options: { limit?: number; action?: string } = {},
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { merchantId, ...(options.action ? { action: options.action } : {}) },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 50,
    });
  }
}

// Prisma's Json input type rejects `undefined` (it only accepts JsonValue | DbNull |
// JsonNull); normalize "nothing to record" to `null` here so callers can just pass
// through whatever they have.
function toJson(value: unknown): object | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value));
}
