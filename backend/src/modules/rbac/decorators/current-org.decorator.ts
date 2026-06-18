import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { tenantId?: string }>();
    return request.tenantId ?? undefined;
  },
);
