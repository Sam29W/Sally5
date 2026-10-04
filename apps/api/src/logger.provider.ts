import type { Provider } from "@nestjs/common";
import { createLogger } from "@app/config";
import { CONFIG } from "./config.provider.js";
import type { AppConfig } from "@app/config";

export const LOGGER = "LOGGER";

export const loggerProvider: Provider = {
  provide: LOGGER,
  inject: [CONFIG],
  useFactory: (config: AppConfig) => createLogger({ level: config.LOG_LEVEL, name: "api" }),
};
