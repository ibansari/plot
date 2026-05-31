import { Module } from "@nestjs/common";
import { CommonModule } from "./common/common.module";
import { InngestModule } from "./inngest/inngest.module";
import { IdentityModule } from "./identity/identity.module";
import { GroupsModule } from "./groups/groups.module";
import { ChatModule } from "./chat/chat.module";
import { PlanModule } from "./plan/plan.module";
import { MoneyModule } from "./money/money.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { NonUserGatewayModule } from "./non-user-gateway/non-user.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { RecallModule } from "./recall/recall.module";

@Module({
  imports: [
    CommonModule,
    InngestModule,
    RecallModule,
    IdentityModule,
    GroupsModule,
    ChatModule,
    PlanModule,
    MoneyModule,
    NotificationsModule,
    NonUserGatewayModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
