import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { MerchantUserRole } from "@prisma/client";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";

export class DashboardTokenInvalidError extends Error {}

export interface DashboardTokenPayload {
  merchantUserId: string;
  merchantId: string;
  role: MerchantUserRole;
}

/** Plain short-lived JWTs, no refresh rotation — a human re-logging in with a password
 * every hour is an acceptable trade for not needing the OTP flow's rotating-refresh-token
 * machinery here. Signed with JWT_DASHBOARD_SECRET, never JWT_ACCESS_SECRET (shopper
 * tokens) — the two token types must never be able to impersonate each other. */
@Injectable()
export class DashboardTokenService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  sign(payload: DashboardTokenPayload): string {
    return jwt.sign(payload, this.config.JWT_DASHBOARD_SECRET, {
      expiresIn: this.config.JWT_DASHBOARD_TTL_SECONDS,
    });
  }

  verify(token: string): DashboardTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.JWT_DASHBOARD_SECRET) as jwt.JwtPayload;
      if (
        typeof decoded.merchantUserId !== "string" ||
        typeof decoded.merchantId !== "string" ||
        typeof decoded.role !== "string"
      ) {
        throw new DashboardTokenInvalidError("Malformed dashboard token");
      }
      return {
        merchantUserId: decoded.merchantUserId,
        merchantId: decoded.merchantId,
        role: decoded.role as MerchantUserRole,
      };
    } catch {
      throw new DashboardTokenInvalidError("Invalid or expired dashboard token");
    }
  }
}
