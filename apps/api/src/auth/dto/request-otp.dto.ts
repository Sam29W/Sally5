import { IsString, MinLength } from "class-validator";

export class RequestOtpDto {
  @IsString()
  @MinLength(8)
  phone!: string;
}
