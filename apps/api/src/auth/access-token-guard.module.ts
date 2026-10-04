import { Module } from "@nestjs/common";
import { TokenService } from "./token.service.js";
import { AccessTokenGuard } from "./guards/access-token.guard.js";

/** Shared by any module whose controllers need `@UseGuards(AccessTokenGuard)` — Nest
 * resolves guard classes from the controller's own module graph, so this must be imported
 * wherever the guard is used, not just where AuthModule lives. */
@Module({
  providers: [TokenService, AccessTokenGuard],
  exports: [TokenService, AccessTokenGuard],
})
export class AccessTokenGuardModule {}
