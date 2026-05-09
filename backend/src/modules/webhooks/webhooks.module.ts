import { Module } from '@nestjs/common';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

import { LivekitSignatureVerifier } from './livekit-signature.verifier';
import { LivekitWebhooksController } from './livekit-webhooks.controller';
import {
  LIVEKIT_WEBHOOK_EVENTS_TOTAL,
  LivekitWebhooksService,
} from './livekit-webhooks.service';

/**
 * Webhooks-модуль. Содержит endpoint `/webhooks/livekit` и счётчик
 * `livekit_webhook_events_total{type, dedup}`.
 */
@Module({
  controllers: [LivekitWebhooksController],
  providers: [
    LivekitWebhooksService,
    LivekitSignatureVerifier,
    makeCounterProvider({
      name: LIVEKIT_WEBHOOK_EVENTS_TOTAL,
      help: 'Количество принятых LiveKit-вебхуков по типам и факту дубликата',
      labelNames: ['type', 'dedup'],
    }),
  ],
})
export class WebhooksModule {}
