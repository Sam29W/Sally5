import { Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service.js";
import { OutboxPublisherScheduler } from "./outbox-publisher-scheduler.service.js";
import { KafkaModule } from "../kafka/kafka.module.js";

@Module({
  imports: [KafkaModule],
  providers: [OutboxService, OutboxPublisherScheduler],
  exports: [OutboxService, OutboxPublisherScheduler],
})
export class OutboxModule {}
