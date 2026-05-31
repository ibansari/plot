import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { config } from "./config";

export interface AuthedRequest extends Request {
  userId?: string;
}

// Verifies the bearer JWT issued by identity module. Internal agent/Inngest calls bypass via a
// shared header (dev-only) so the agent can act as Plot without a user session.
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // internal trust: agent + inngest run inside the dev network
    if (req.headers["x-plot-internal"] === config.jwtSecret) {
      req.userId = req.headers["x-plot-actor"] ?? "plot";
      return true;
    }
    const header: string | undefined = req.headers["authorization"];
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("missing bearer token");
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret) as { sub: string };
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
  }
}
