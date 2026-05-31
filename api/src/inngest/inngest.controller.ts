import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { serve } from "inngest/express";
import { InngestService } from "./inngest.service";
import { buildFunctions } from "./functions";

// Serves the Inngest endpoint the dev server polls (PUT registers, POST invokes).
@Controller("api/inngest")
export class InngestController {
  private readonly handler: (req: Request, res: Response) => unknown;

  constructor(private readonly inngest: InngestService) {
    this.handler = serve({
      client: this.inngest.client,
      functions: buildFunctions(this.inngest.client),
    }) as unknown as (req: Request, res: Response) => unknown;
  }

  @All()
  all(@Req() req: Request, @Res() res: Response) {
    return this.handler(req, res);
  }
}
