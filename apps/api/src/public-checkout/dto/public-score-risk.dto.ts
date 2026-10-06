import { IsString, MinLength } from "class-validator";

export class PublicScoreRiskDto {
  @IsString()
  @MinLength(1)
  addressId!: string;
}
