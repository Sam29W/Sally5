import type { Request } from "express";

/** `req.ip` already accounts for `TRUST_PROXY_HOPS` (see trust-proxy.ts) — never raw
 * `X-Forwarded-For` directly, which would be spoofable without that configuration. */
export function auditContext(req: Request): { ipAddress: string; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? "unknown",
    userAgent: req.header("user-agent") ?? null,
  };
}
