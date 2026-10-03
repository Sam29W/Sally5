import { Global, Module } from "@nestjs/common";
import { CONFIG, configProvider } from "./config.provider.js";
import { LOGGER, loggerProvider } from "./logger.provider.js";

@Global()
@Module({
  providers: [configProvider, loggerProvider],
  exports: [CONFIG, LOGGER],
})
export class CoreModule {}
