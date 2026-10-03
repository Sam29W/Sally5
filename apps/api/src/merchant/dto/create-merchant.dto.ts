import { IsString, MinLength } from "class-validator";

export class CreateMerchantDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
