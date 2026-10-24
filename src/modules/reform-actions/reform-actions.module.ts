import { Module } from "@nestjs/common";
import { ReformActionsController } from "@/modules/reform-actions/reform-actions.controller";
import { ReformActionsService } from "@/modules/reform-actions/reform-actions.service";

@Module({
  controllers: [ReformActionsController],
  providers: [ReformActionsService],
})
export class ReformActionsModule {}
