import { IsOptional, IsString, MinLength } from "class-validator";

export class AddressInputDto {
  @IsString()
  @MinLength(1)
  line1!: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  @MinLength(1)
  city!: string;

  @IsString()
  @MinLength(1)
  state!: string;

  @IsString()
  @MinLength(1)
  pincode!: string;

  @IsOptional()
  @IsString()
  country?: string;
}
