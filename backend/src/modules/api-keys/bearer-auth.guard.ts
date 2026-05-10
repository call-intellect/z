import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@prisma/client';

import { ApiKeysService } from './api-keys.service';
import type { RequestWithApiKey } from './current-api-key.decorator';

/**
 * Метаданные `@RequireScope('read'|'write')` — задают требуемый scope
 * на эндпоинте. Если не задано — по умолчанию 'read'.
 */
export const REQUIRE_SCOPE_KEY = 'api_key_required_scope';

import { SetMetadata } from '@nestjs/common';
export const RequireScope = (scope: ApiKeyScope): MethodDecorator =>
  SetMetadata(REQUIRE_SCOPE_KEY, scope);

/**
 * Guard для Public API.
 *
 * Алгоритм:
 *   1. `Authorization: Bearer z_...` — извлекаем.
 *   2. sha256(token) → ищем `ApiKey.hashedKey`.
 *   3. revoked → 401.
 *   4. Проверяем scope (`read` или `write` — из `@RequireScope`).
 *   5. `req.apiKey = ApiKey`, `req.apiUserId = ApiKey.userId`.
 *   6. Fire-and-forget update `lastUsedAt = now`.
 */
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

    // Scope check.
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
    // Phase 12: ставим `req.tenantId` для EntitlementGuard (на gated public-api
    // эндпоинтах). System-wide ключи без tenantId — пропускаем (tenantId=null).
    if (apiKey.tenantId) {
      (req as unknown as { tenantId?: string }).tenantId = apiKey.tenantId;
    }
    // Fire-and-forget — не блокируем запрос на UPDATE.
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
