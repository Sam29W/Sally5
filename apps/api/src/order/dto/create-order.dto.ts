import { IsString, MinLength } from "class-validator";

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  cartSessionId!: string;
}
