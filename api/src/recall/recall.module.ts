import { Global, Module } from "@nestjs/common";
import { RecallService } from "./recall.service";
import { RecallController } from "./recall.controller";

// Global so PlanService can inject RecallService (remember on lock, annotate on propose).
@Global()
@Module({
  controllers: [RecallController],
  providers: [RecallService],
  exports: [RecallService],
})
export class RecallModule {}
