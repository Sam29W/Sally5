import { IsString, MinLength } from "class-validator";

export class ScoreOrderDto {
  @IsString()
  @MinLength(1)
  addressId!: string;
}
