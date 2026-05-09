import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';


export interface CurrentPartnerPayload {
  id: string;
  partnerName: string;
}

/**
 * Достаёт `req.partner`, заполненный `HmacGuard`. Используется в Crossmark-контроллерах
 * для логирования и аудита (кто из партнёров вызвал endpoint).
 */
export const CurrentPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentPartnerPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.partner;
  },
);
