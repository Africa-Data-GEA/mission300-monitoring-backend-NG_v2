import { PartialType } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { CreateReformActionDto } from "@/modules/reform-actions/dto/create-reform-action.dto";

export class UpdateReformActionDto extends PartialType(CreateReformActionDto) {
  @IsOptional()
  @IsString()
  statusNote?: string;
}
