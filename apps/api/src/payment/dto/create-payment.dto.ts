import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreatePaymentDto {
  @IsString()
  @MinLength(1)
  orderId!: string;

  @IsOptional()
  @IsIn(["card", "upi", "netbanking"])
  method?: "card" | "upi" | "netbanking";
}
