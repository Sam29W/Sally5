import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateCodRiskConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  highValueThresholdCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowAddressQualityThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  riskyHourStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  riskyHourEnd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  velocityThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowBandMax?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  mediumBandMax?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  highRtoPincodes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedPincodes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedPhoneHashes?: string[];
}
