import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json as expressJson } from 'express';

/**
 * Middleware, который сохраняет сырой `Buffer` тела запроса в `req.rawBody`,
 * параллельно сохраняя стандартное поведение `express.json()` (парсинг в
 * `req.body`).
 *
 * Применять адресно: `/integrations/crossmark/*` и `/webhooks/livekit`.
 * Подключать через `MiddlewareConsumer.forRoutes(...)`.
 *
 * Для остальных endpoint'ов — стандартный `express.json()` из Nest продолжает
 * работать (там нет необходимости в rawBody).
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  private readonly handler = expressJson({
    limit: '1mb',
    verify: (req, _res, buf) => {
      // Buffer уже скопирован — express.json не выдаёт ссылку на свой буфер.
      (req as unknown as Request).rawBody = Buffer.from(buf);
    },
  });

  use(req: Request, res: Response, next: NextFunction): void {
    this.handler(req, res, next);
  }
}
