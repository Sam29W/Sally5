import { IsBoolean } from "class-validator";

export class RecordOutcomeDto {
  @IsBoolean()
  delivered!: boolean;
}
