import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadConfig, createLogger } from "@checkoutkit/config";
import { AppModule } from "./app.module.js";
import { requestIdMiddleware } from "./request-id.middleware.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, name: "api" });

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(requestIdMiddleware);

  await app.listen(config.PORT);
  logger.info({ port: config.PORT }, "api started");
}

bootstrap().catch((err: unknown) => {
  console.error("fatal startup error", err);
  process.exit(1);
});
