import { IsString, MinLength } from "class-validator";

export class ShareAddressDto {
  @IsString()
  @MinLength(1)
  merchantId!: string;
}
