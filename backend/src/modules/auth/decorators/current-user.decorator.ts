import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentUserPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
  jti?: string;
  livekitIdentity?: string;
  participantId?: string;
  name?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload | null | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user ?? undefined;
  },
);
