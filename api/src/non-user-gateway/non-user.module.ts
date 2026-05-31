import { Module } from "@nestjs/common";
import { NonUserGatewayService } from "./non-user.service";
import { NonUserGatewayController } from "./non-user.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { PlanModule } from "../plan/plan.module";

@Module({
  imports: [NotificationsModule, PlanModule],
  controllers: [NonUserGatewayController],
  providers: [NonUserGatewayService],
  exports: [NonUserGatewayService],
})
export class NonUserGatewayModule {}
