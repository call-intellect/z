import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { IntegrationKeyInvalidError } from '../../common/errors/domain-errors';

import { LivekitWebhooksService } from './livekit-webhooks.service';

@ApiExcludeController()
@Controller('webhooks')
export class LivekitWebhooksController {
  private readonly logger = new Logger(LivekitWebhooksController.name);

  constructor(
    @Inject(LivekitWebhooksService)
    private readonly service: LivekitWebhooksService,
  ) {}

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
      if (err instanceof IntegrationKeyInvalidError) {
        throw err;
      }
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Ошибка обработки LiveKit-webhook (отдаём 200)',
      );
    }
  }
}
