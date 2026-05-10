import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Достаёт `req.tenantId`, заполненный `TenantGuard`. Если guard не подключён
 * или tenantId не установлен — undefined.
 *
 * Использование:
 *   @Get(':id')
 *   @UseGuards(CookieAuthGuard, TenantGuard)
 *   async byId(@CurrentOrg() tenantId: string, @Param('id') id: string) { ... }
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<
      Request & { tenantId?: string }
    >();
    return request.tenantId ?? undefined;
  },
);
