import { IsIn } from "class-validator";

export class PublicCreatePaymentDto {
  @IsIn(["card", "upi", "netbanking"])
  method!: "card" | "upi" | "netbanking";
}
