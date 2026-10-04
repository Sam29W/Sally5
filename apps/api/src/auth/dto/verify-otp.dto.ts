import { IsString, Matches, MinLength } from "class-validator";

export class VerifyOtpDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "otp must be exactly 6 digits" })
  otp!: string;
}
