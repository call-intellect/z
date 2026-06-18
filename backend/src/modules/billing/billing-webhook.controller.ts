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
