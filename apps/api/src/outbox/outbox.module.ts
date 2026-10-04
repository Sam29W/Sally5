import { Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service.js";
import { KafkaModule } from "../kafka/kafka.module.js";

@Module({
  imports: [KafkaModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
