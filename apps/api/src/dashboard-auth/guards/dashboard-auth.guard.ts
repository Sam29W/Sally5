import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { MerchantUserRole } from "@prisma/client";
import { DashboardTokenService } from "../dashboard-token.service.js";

export interface DashboardAuthenticatedRequest extends Request {
  merchantUserId: string;
  merchantId: string;
  role: MerchantUserRole;
}

export const ROLES_KEY = "dashboard_roles";
/** Restricts a route to one or more roles. Omit entirely to allow any authenticated
 * dashboard user — read-only access to e.g. order lists is intentionally not owner-gated. */
export const RequireRole = (...roles: MerchantUserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    @Inject(DashboardTokenService) private readonly tokenService: DashboardTokenService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<DashboardAuthenticatedRequest>();
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new UnauthorizedException("Missing bearer dashboard token");
    }

    let merchantUserId: string;
    let merchantId: string;
    let role: MerchantUserRole;
    try {
      ({ merchantUserId, merchantId, role } = this.tokenService.verify(token));
    } catch {
      throw new UnauthorizedException("Invalid or expired dashboard token");
    }
    req.merchantUserId = merchantUserId;
    req.merchantId = merchantId;
    req.role = role;

    const requiredRoles = this.reflector.get<MerchantUserRole[] | undefined>(
      ROLES_KEY,
      context.getHandler(),
    );
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      throw new ForbiddenException(`Requires one of: ${requiredRoles.join(", ")}`);
    }
    return true;
  }
}
