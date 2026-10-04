import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadConfig, createLogger } from "@app/config";
import { AppModule } from "./app.module.js";
import { requestIdMiddleware } from "./request-id.middleware.js";
import { applyTrustProxy } from "./trust-proxy.js";
import { applyBodyParsers } from "./body-parser.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL, name: "api" });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  applyTrustProxy(app, config.TRUST_PROXY_HOPS);
  applyBodyParsers(app);
  app.use(requestIdMiddleware);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  await app.listen(config.PORT);
  logger.info({ port: config.PORT }, "api started");
}

bootstrap().catch((err: unknown) => {
  console.error("fatal startup error", err);
  process.exit(1);
});
