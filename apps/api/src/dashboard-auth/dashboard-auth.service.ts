import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { MerchantUserRole, type MerchantUser } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.util.js";
import { DashboardTokenService } from "./dashboard-token.service.js";

@Injectable()
export class DashboardAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DashboardTokenService) private readonly tokenService: DashboardTokenService,
  ) {}

  /** Proof of ownership is the merchant's own API key (ApiKeyGuard already resolved
   * `merchantId` by the time this runs) — the one and only owner account per merchant can
   * only ever be bootstrapped once; a second call is a 409, not a silent reset. */
  async bootstrapOwner(merchantId: string, email: string, password: string): Promise<void> {
    const existingOwner = await this.prisma.merchantUser.findFirst({
      where: { merchantId, role: MerchantUserRole.owner },
    });
    if (existingOwner) {
      throw new ConflictException("This merchant already has an owner account");
    }
    await this.prisma.merchantUser.create({
      data: {
        merchantId,
        email,
        passwordHash: hashPassword(password),
        role: MerchantUserRole.owner,
      },
    });
  }

  /** Only an owner can invite colleagues — enforced by the controller's @RequireRole. */
  async inviteUser(
    merchantId: string,
    email: string,
    password: string,
    role: MerchantUserRole,
  ): Promise<Pick<MerchantUser, "id" | "email" | "role">> {
    const user = await this.prisma.merchantUser.create({
      data: { merchantId, email, passwordHash: hashPassword(password), role },
    });
    return { id: user.id, email: user.email, role: user.role };
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.merchantUser.findUnique({ where: { email } });
    // Always run verifyPassword, even against a throwaway hash when the user doesn't
    // exist — otherwise a missing-email response returns measurably faster than a
    // wrong-password one, which leaks which emails are registered via response timing.
    const hash = user?.passwordHash ?? hashPassword("not-a-real-password");
    const valid = verifyPassword(password, hash);
    if (!user || !valid) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const accessToken = this.tokenService.sign({
      merchantUserId: user.id,
      merchantId: user.merchantId,
      role: user.role,
    });
    return { accessToken };
  }

  async me(merchantUserId: string): Promise<Pick<MerchantUser, "id" | "email" | "role">> {
    const user = await this.prisma.merchantUser.findUniqueOrThrow({
      where: { id: merchantUserId },
    });
    return { id: user.id, email: user.email, role: user.role };
  }
}
