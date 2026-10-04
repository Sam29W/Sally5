import { Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { PaymentService } from "./payment.service.js";
import { signatureHeaderNameFor } from "./webhook-signature-header.js";

/**
 * Gateway-to-us, not merchant-to-us — no ApiKeyGuard here. Authentication is the
 * gateway's own webhook signature, verified over the raw request body (see main.ts's
 * body-parser branching: this path gets express.raw(), not express.json(), specifically
 * so the exact bytes the gateway signed are still available when we verify).
 */
@Controller("payments/webhook")
export class WebhookController {
  constructor(@Inject(PaymentService) private readonly paymentService: PaymentService) {}

  @Post(":gateway")
  @HttpCode(HttpStatus.OK)
  async receive(@Param("gateway") gateway: string, @Req() req: Request) {
    const rawBody = req.body as Buffer;
    const signature = req.header(signatureHeaderNameFor(gateway));
    return this.paymentService.processWebhook(gateway, rawBody, signature);
  }
}
