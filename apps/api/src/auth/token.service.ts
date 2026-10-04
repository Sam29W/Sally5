import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { PrismaService } from "../prisma/prisma.service.js";

export class RefreshTokenReuseError extends Error {}
export class RefreshTokenInvalidError extends Error {}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque refresh token: `<refreshTokenId>.<secret>` — the id lets us look up without a table scan. */
function packRefreshToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}

function unpackRefreshToken(token: string): { id: string; secret: string } {
  const [id, secret] = token.split(".");
  if (!id || !secret) {
    throw new RefreshTokenInvalidError("Malformed refresh token");
  }
  return { id, secret };
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  signAccessToken(shopperId: string): string {
    return jwt.sign({ sub: shopperId }, this.config.JWT_ACCESS_SECRET, {
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
    });
  }

  verifyAccessToken(token: string): { shopperId: string } {
    const payload = jwt.verify(token, this.config.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (typeof payload.sub !== "string") {
      throw new RefreshTokenInvalidError("Malformed access token");
    }
    return { shopperId: payload.sub };
  }

  /** Starts a brand new session family (used on fresh OTP login). */
  async issueNewSession(shopperId: string): Promise<TokenPair> {
    const family = await this.prisma.sessionFamily.create({ data: { shopperId } });
    return this.issueTokenPairInFamily(family.id, shopperId);
  }

  /**
   * Rotates a refresh token. If the presented token was already rotated (reused), the
   * entire session family is revoked and every future refresh in that family fails —
   * this is the reuse-detection mechanism.
   */
  async rotate(presentedToken: string): Promise<TokenPair> {
    const { id, secret } = unpackRefreshToken(presentedToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { id },
      include: { family: true },
    });

    if (!record || record.tokenHash !== hashToken(secret)) {
      throw new RefreshTokenInvalidError("Refresh token not found or invalid");
    }
    if (record.family.revokedAt) {
      throw new RefreshTokenReuseError("Session family revoked");
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new RefreshTokenInvalidError("Refresh token expired");
    }
    if (record.rotatedAt) {
      // This exact token was already consumed once — reuse. Revoke the whole family.
      await this.prisma.sessionFamily.update({
        where: { id: record.familyId },
        data: { revokedAt: new Date() },
      });
      throw new RefreshTokenReuseError("Refresh token reuse detected — session revoked");
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { rotatedAt: new Date() },
    });

    return this.issueTokenPairInFamily(record.familyId, record.family.shopperId);
  }

  async revokeFamilyByToken(presentedToken: string): Promise<void> {
    const { id, secret } = unpackRefreshToken(presentedToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!record || record.tokenHash !== hashToken(secret)) {
      throw new RefreshTokenInvalidError("Refresh token not found or invalid");
    }
    await this.prisma.sessionFamily.update({
      where: { id: record.familyId },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPairInFamily(familyId: string, shopperId: string): Promise<TokenPair> {
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.JWT_REFRESH_TTL_SECONDS * 1000);
    const created = await this.prisma.refreshToken.create({
      data: { familyId, tokenHash: hashToken(secret), expiresAt },
    });

    return {
      accessToken: this.signAccessToken(shopperId),
      refreshToken: packRefreshToken(created.id, secret),
      expiresInSeconds: this.config.JWT_ACCESS_TTL_SECONDS,
    };
  }
}
