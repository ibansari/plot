import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { config } from "./common/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  await app.listen(config.port);
  const log = new Logger("Bootstrap");
  log.log(`✦ PLOT API on http://localhost:${config.port}`);
  log.log(`   providers — auth:${config.authProvider} comms:${config.commsProvider} ` +
    `pay:${config.paymentProvider} calendar:${config.calendarProvider} places:${config.placesProvider}`);
  log.log(`   soft deadline: ${config.softDeadlineSeconds}s · inngest dev: ${config.inngestDev}`);
}
bootstrap();
