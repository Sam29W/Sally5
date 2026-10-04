import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { OutboxService } from "./outbox.service.js";

/**
 * Drains unpublished outbox rows to Kafka on a fixed interval. This is the piece that
 * turns the outbox *pattern* (proven durable in outbox.service.test.ts) into something
 * that actually delivers events in a running app — without it, rows would sit unpublished
 * forever unless something else called publishPending().
 *
 * Disabled in NODE_ENV=test: tests drive OutboxService directly and don't want a
 * background timer racing their assertions or double-publishing into a shared Kafka topic.
 */
@Injectable()
export class OutboxPublisherScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(OutboxService) private readonly outboxService: OutboxService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.NODE_ENV === "test") {
      return;
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.OUTBOX_PUBLISH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One drain pass. A failure here (e.g. Kafka briefly unreachable) is logged and
   * swallowed — already-published rows stay published, unpublished rows stay unpublished,
   * and the next scheduled tick simply picks up where this one left off. Nothing is lost
   * either way, which is the whole point of the outbox pattern. */
  async runOnce(): Promise<number> {
    try {
      return await this.outboxService.publishPending();
    } catch (err) {
      this.logger.error("outbox publish pass failed; will retry on the next tick", err);
      return 0;
    }
  }
}
