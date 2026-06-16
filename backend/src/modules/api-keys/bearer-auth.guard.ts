import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@prisma/client';

import { ApiKeysService } from './api-keys.service';
import type { RequestWithApiKey } from './current-api-key.decorator';

export const REQUIRE_SCOPE_KEY = 'api_key_required_scope';

export const RequireScope = (scope: ApiKeyScope): MethodDecorator =>
  SetMetadata(REQUIRE_SCOPE_KEY, scope);

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    @Inject(ApiKeysService) private readonly svc: ApiKeysService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithApiKey>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.invalid('Требуется заголовок Authorization: Bearer ...');
    }
    const token = header.slice(7).trim();
    if (!token.startsWith('z_')) {
      throw this.invalid('Невалидный формат API-ключа');
    }
    const apiKey = await this.svc.resolveByRawKey(token);
    if (!apiKey) {
      throw this.invalid('API-ключ не найден или отозван');
    }

    const required =
      this.reflector.getAllAndOverride<ApiKeyScope>(REQUIRE_SCOPE_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? 'read';
    if (!apiKey.scopes.includes(required)) {
      throw new UnauthorizedException({
        ok: false,
        error: {
          code: 'insufficient_scope',
          message: `Требуется scope=${required}`,
        },
      });
    }

    req.apiKey = apiKey;
    req.apiUserId = apiKey.userId;
    if (apiKey.tenantId) {
      (req as unknown as { tenantId?: string }).tenantId = apiKey.tenantId;
    }
    void this.svc.touchLastUsed(apiKey.id);
    return true;
  }

  private invalid(message: string): UnauthorizedException {
    return new UnauthorizedException({
      ok: false,
      error: { code: 'invalid_api_key', message },
    });
  }
}
