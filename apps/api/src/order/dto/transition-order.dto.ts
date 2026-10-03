import { OrderStatus } from "@prisma/client";
import { IsEnum } from "class-validator";

export class TransitionOrderDto {
  @IsEnum(OrderStatus)
  to!: OrderStatus;
}
