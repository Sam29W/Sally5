import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { DEFAULT_COD_RISK_CONFIG, RULE_VERSION, type CodRiskConfig } from "./cod-risk-types.js";

@Injectable()
export class CodRiskConfigService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getForMerchant(merchantId: string): Promise<CodRiskConfig> {
    const stored = await this.prisma.codRiskConfig.findUnique({ where: { merchantId } });
    if (!stored) {
      return DEFAULT_COD_RISK_CONFIG;
    }
    return {
      ruleVersion: RULE_VERSION,
      highValueThresholdCents: stored.highValueThresholdCents,
      lowAddressQualityThreshold: stored.lowAddressQualityThreshold,
      riskyHourStart: stored.riskyHourStart,
      riskyHourEnd: stored.riskyHourEnd,
      velocityThreshold: stored.velocityThreshold,
      lowBandMax: stored.lowBandMax,
      mediumBandMax: stored.mediumBandMax,
      highRtoPincodes: stored.highRtoPincodes,
      blockedPincodes: stored.blockedPincodes,
      blockedPhoneHashes: stored.blockedPhoneHashes,
    };
  }

  async upsertForMerchant(
    merchantId: string,
    partial: Partial<Omit<CodRiskConfig, "ruleVersion">>,
  ): Promise<CodRiskConfig> {
    const current = await this.getForMerchant(merchantId);
    // Note: a DTO instance's declared-but-unset optional fields are own properties with
    // value `undefined` (TS class-field semantics under useDefineForClassFields) — a
    // plain spread would overwrite `current`'s real values with those undefineds, so
    // skip any key the caller didn't actually provide a value for.
    const merged = { ...current };
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    await this.prisma.codRiskConfig.upsert({
      where: { merchantId },
      create: { merchantId, ...withoutRuleVersion(merged) },
      update: withoutRuleVersion(merged),
    });
    return merged;
  }
}

function withoutRuleVersion(config: CodRiskConfig) {
  return {
    highValueThresholdCents: config.highValueThresholdCents,
    lowAddressQualityThreshold: config.lowAddressQualityThreshold,
    riskyHourStart: config.riskyHourStart,
    riskyHourEnd: config.riskyHourEnd,
    velocityThreshold: config.velocityThreshold,
    lowBandMax: config.lowBandMax,
    mediumBandMax: config.mediumBandMax,
    highRtoPincodes: [...config.highRtoPincodes],
    blockedPincodes: [...config.blockedPincodes],
    blockedPhoneHashes: [...config.blockedPhoneHashes],
  };
}
