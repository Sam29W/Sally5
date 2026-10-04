import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { LOGGER } from "../logger.provider.js";
import type { SmsProvider } from "./sms-provider.js";

/** Dev/test-only driver — no real SMS gateway is wired until a later stage. */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  async send(phone: string, message: string): Promise<void> {
    // `phone` and any OTP-shaped substring in `message` are redacted by the logger itself.
    this.logger.info({ phone, message }, "sms dispatched (console driver)");
  }
}
