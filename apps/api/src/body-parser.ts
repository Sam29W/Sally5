import express, { type NextFunction, type Request, type Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

const WEBHOOK_PATH_PREFIX = "/payments/webhook";

/**
 * Webhook signature verification needs the *exact* bytes the gateway signed — if Nest's
 * default JSON body parser runs first, it re-serializes the parsed object, which is not
 * guaranteed to byte-match the original (whitespace, key order). So webhook routes get
 * express.raw() (req.body becomes a Buffer) and everything else gets the normal
 * express.json(). Exported so both main.ts and e2e tests wire up identical behavior.
 */
export function applyBodyParsers(app: NestExpressApplication): void {
  const rawParser = express.raw({ type: "*/*" });
  const jsonParser = express.json();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(WEBHOOK_PATH_PREFIX)) {
      rawParser(req, res, next);
    } else {
      jsonParser(req, res, next);
    }
  });
}
