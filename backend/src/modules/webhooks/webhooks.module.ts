import { Module } from '@nestjs/common';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

import { CompositeEgressReconcileCron } from './cron/composite-egress-reconcile.cron';
import { LivekitEventsHandler } from './livekit-events.handler';
import { LivekitSignatureVerifier } from './livekit-signature.verifier';
import { LivekitWebhooksController } from './livekit-webhooks.controller';
import {
  LIVEKIT_WEBHOOK_EVENTS_TOTAL,
  LivekitWebhooksService,
} from './livekit-webhooks.service';
import { MeetingFinalizationService } from './meeting-finalization.service';

/**
 * Webhooks-модуль. Содержит endpoint `/webhooks/livekit` и счётчик
 * `livekit_webhook_events_total{type, dedup}`.
 *
 * `LivekitEventsHandler` — маршрутизатор по типам событий: room_started/finished
 * → FSM, participant_joined/left → upsert. Регистрируется как provider, чтобы
 * `LivekitWebhooksService` вызывал его после дедупа.
 *
 * `CompositeEgressReconcileCron` — pull-фоллбэк на потерянный/задержанный
 * composite egress-вебхук (ТЗ 2026-06-06): раз в минуту догоняет финализацию
 * через `RecordingsService.reconcileCompositeEgress` + `MeetingFinalizationService`.
 */
@Module({
  controllers: [LivekitWebhooksController],
  providers: [
    LivekitWebhooksService,
    LivekitSignatureVerifier,
    LivekitEventsHandler,
    MeetingFinalizationService,
    CompositeEgressReconcileCron,
    makeCounterProvider({
      name: LIVEKIT_WEBHOOK_EVENTS_TOTAL,
      help: 'Количество принятых LiveKit-вебхуков по типам и факту дубликата',
      labelNames: ['type', 'dedup'],
    }),
  ],
})
export class WebhooksModule {}
