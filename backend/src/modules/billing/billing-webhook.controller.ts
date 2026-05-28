/**
 * BillingWebhookController — приём webhook'ов от платёжного провайдера.
 *
 * Маршрут: `/api/v1/internal/billing/provider-events` (public, БЕЗ auth).
 *
 * Точка шлёт **JWT-строку** в теле. В Z глобально `express.json({verify})`
 * сохраняет rawBody в `req.rawBody` для всех JSON-запросов. Для webhook'а
 * (Content-Type обычно application/jose или text/plain) подключаем
 * отдельный middleware express.text({type: any}) для именно этого пути
 * (см. main.ts).
 *
 * GET/HEAD варианты — для probe Точки при регистрации webhook'а: должны
 * отвечать 200 OK без тела (или с маленьким JSON).
 *
 * Эндпоинт ВСЕГДА отвечает 200 — даже на invalid signature / duplicate /
 * unknown invoice (см. BillingService.handleProviderWebhook), чтобы Точка
 * не уходила в retry-loop.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.4 + port-brief §13.
 */

import {
  Body,
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { BillingService } from './services/billing.service';

@ApiTags('billing-webhook')
@Controller('api/v1/internal/billing')
export class BillingWebhookController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  /** Probe от Точки при регистрации webhook'а — должно ответить 200. */
  @Get('provider-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook probe (GET) для регистрации в Точке.' })
  probeGet(): { ok: true } {
    return { ok: true };
  }

  @Head('provider-events')
  @HttpCode(HttpStatus.OK)
  probeHead(): void {
    return;
  }

  /**
   * Основной webhook-приёмник. Точка POST'ит JWT-строку в body
   * (Content-Type: application/jose либо text/plain).
   */
  @Post('provider-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Webhook от платёжного провайдера (Точка). ' +
      'Принимает JWT-строку в теле. Всегда 200, даже при невалидной подписи.',
  })
  async handle(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
  ): Promise<{ ok: boolean; reason?: string; invoiceId?: string }> {
    const result = await this.billing.handleProviderWebhook(headers, body);
    return result;
  }
}
