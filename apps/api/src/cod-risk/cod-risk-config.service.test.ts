import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service.js";
import { MerchantService } from "../merchant/merchant.service.js";
import { DEFAULT_COD_RISK_CONFIG } from "./cod-risk-types.js";
import { CodRiskConfigService } from "./cod-risk-config.service.js";

const prisma = new PrismaService();
const merchantService = new MerchantService(prisma);
const configService = new CodRiskConfigService(prisma);

let merchantId: string;

beforeEach(async () => {
  await prisma.$connect();
  const { merchant } = await merchantService.createMerchantWithApiKey(
    `Config Test ${randomUUID()}`,
  );
  merchantId = merchant.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CodRiskConfigService", () => {
  it("returns the engine defaults for a merchant that never configured anything", async () => {
    const config = await configService.getForMerchant(merchantId);
    expect(config).toEqual(DEFAULT_COD_RISK_CONFIG);
  });

  it("persists a partial update and returns the merged config", async () => {
    const updated = await configService.upsertForMerchant(merchantId, {
      highValueThresholdCents: 1000000,
      blockedPincodes: ["560001"],
    });
    expect(updated.highValueThresholdCents).toBe(1000000);
    expect(updated.blockedPincodes).toEqual(["560001"]);
    // Everything else should still be the default.
    expect(updated.lowBandMax).toBe(DEFAULT_COD_RISK_CONFIG.lowBandMax);

    const reloaded = await configService.getForMerchant(merchantId);
    expect(reloaded).toEqual(updated);
  });

  it("a second partial update merges onto the first, not back to defaults", async () => {
    await configService.upsertForMerchant(merchantId, { velocityThreshold: 10 });
    const second = await configService.upsertForMerchant(merchantId, {
      lowBandMax: 20,
    });
    expect(second.velocityThreshold).toBe(10);
    expect(second.lowBandMax).toBe(20);
  });

  it("one merchant's config is invisible to another", async () => {
    const { merchant: other } = await merchantService.createMerchantWithApiKey(
      `Other Config Test ${randomUUID()}`,
    );
    await configService.upsertForMerchant(merchantId, { blockedPincodes: ["999999"] });

    const otherConfig = await configService.getForMerchant(other.id);
    expect(otherConfig.blockedPincodes).toEqual([]);
  });
});
