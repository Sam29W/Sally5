import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";
import { MerchantUserRole } from "@prisma/client";

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsEnum(MerchantUserRole)
  role!: MerchantUserRole;
}
