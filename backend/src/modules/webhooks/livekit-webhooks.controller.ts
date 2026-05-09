import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { IntegrationKeyInvalidError } from '../../common/errors/domain-errors';

import { LivekitWebhooksService } from './livekit-webhooks.service';

/**
 * Контроллер вебхуков LiveKit.
 *
 * `POST /webhooks/livekit`:
 *   - читает raw body (`req.rawBody`, заполняется `RawBodyMiddleware`);
 *   - читает заголовок `Authorization`;
 *   - делегирует в `LivekitWebhooksService.handle(...)`.
 *
 * Контракт ответа: всегда 200 с пустым телом, кроме случая невалидной
 * подписи (401), чтобы LiveKit не ретраил вечно после нашей ошибки.
 */
@ApiExcludeController()
@Controller('webhooks')
export class LivekitWebhooksController {
  private readonly logger = new Logger(LivekitWebhooksController.name);

  constructor(private readonly service: LivekitWebhooksService) {}

  @Post('livekit')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: Request,
    @Headers('authorization') authHeader: string | undefined,
  ): Promise<void> {
    const rawBody = req.rawBody ?? Buffer.alloc(0);

    try {
      await this.service.handle(rawBody, authHeader);
    } catch (err) {
      // Невалидная подпись — пробрасываем (фильтр вернёт 401).
      if (err instanceof IntegrationKeyInvalidError) {
        throw err;
      }
      // Остальные ошибки — лог и 200, иначе LiveKit будет ретраить вечно.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Ошибка обработки LiveKit-webhook (отдаём 200)',
      );
    }
  }
}
