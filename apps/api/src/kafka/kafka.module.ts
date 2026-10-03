import { Global, Module } from "@nestjs/common";
import { Kafka, type Producer } from "kafkajs";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";

export const KAFKA_PRODUCER = "KAFKA_PRODUCER";

@Global()
@Module({
  providers: [
    {
      provide: KAFKA_PRODUCER,
      inject: [CONFIG],
      useFactory: async (config: AppConfig): Promise<Producer> => {
        const kafka = new Kafka({
          clientId: "checkoutkit-api",
          brokers: config.KAFKA_BROKERS.split(","),
          retry: { retries: 3 },
        });
        const producer = kafka.producer();
        await producer.connect();
        return producer;
      },
    },
  ],
  exports: [KAFKA_PRODUCER],
})
export class KafkaModule {}
