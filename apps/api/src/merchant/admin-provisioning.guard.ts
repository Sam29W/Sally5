import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";

/**
 * Gates POST /merchants. Minting the first API key for a brand-new merchant is the one
 * operation in this API that fundamentally cannot require an API key — none exists yet —
 * so it's gated by a shared operator secret instead, checked here rather than left wide
 * open to anyone who can reach the API (see decision 003's original gap, closed here).
 */
@Injectable()
export class AdminProvisioningGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.header("x-admin-provisioning-key");
    if (!presented) {
      throw new UnauthorizedException("Missing x-admin-provisioning-key header");
    }
    const expected = Buffer.from(this.config.ADMIN_PROVISIONING_KEY);
    const actual = Buffer.from(presented);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException("Invalid admin provisioning key");
    }
    return true;
  }
}
