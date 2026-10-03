import { Global, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Redis => new Redis(config.REDIS_URL),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
