import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { MerchantService } from "./merchant.service.js";

export interface MerchantAuthenticatedRequest extends Request {
  merchantId: string;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(MerchantService) private readonly merchantService: MerchantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MerchantAuthenticatedRequest>();
    const apiKey = req.header("x-api-key");
    if (!apiKey) {
      throw new UnauthorizedException("Missing x-api-key header");
    }

    const merchantId = await this.merchantService.authenticate(apiKey);
    if (!merchantId) {
      throw new UnauthorizedException("Invalid or revoked API key");
    }

    req.merchantId = merchantId;
    return true;
  }
}
