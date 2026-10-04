import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { ReconciliationService } from "./reconciliation.service.js";

/** Same pattern as OutboxPublisherScheduler (Stage 3): plain setInterval so the period can
 * come from a runtime env var, disabled under NODE_ENV=test, failures logged and
 * swallowed so one bad tick doesn't kill the timer. */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ReconciliationService) private readonly reconciliationService: ReconciliationService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === "test") return;
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.RECONCILIATION_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<number> {
    try {
      return await this.reconciliationService.reconcilePending();
    } catch (err) {
      this.logger.error("reconciliation pass failed; will retry on the next tick", err);
      return 0;
    }
  }
}
