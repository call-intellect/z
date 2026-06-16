import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { ApiKey } from '@prisma/client';
import type { Request } from 'express';

export interface RequestWithApiKey extends Request {
  apiKey?: ApiKey;
  apiUserId?: string;
}

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKey | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithApiKey>();
    return req.apiKey;
  },
);

export const CurrentApiUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithApiKey>();
    return req.apiUserId;
  },
);
