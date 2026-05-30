import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import type { InboundMessage } from '../../conversational/types/channel.types';
import { getLocalDate } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { CheckinParserService } from './checkin-parser.service';
import { DailyCheckInService } from './daily-checkin.service';
import { OperationsDashboardService } from './operations-dashboard.service';

/**
 * SBA β-8 — CheckinResponseHandler.
 *
 * Слушает `notification.responded`, эмиттированный
 * `ConversationalService.respondToProbe`. Если eventType='checkin.prompt' (или
 * payload.metaJson.kind='checkin'), считает это ответом на morning/evening
 * чек-ин и сохраняет в `DailyCheckIn`.
 *
 * Алгоритм:
 *   1. Найти исходный Notification, прочитать его payload (там лежит kind +
 *      dateLocal + personId — мы их кладём в `DailyCheckInPromptCron`).
 *   2. Извлечь rawText из responsePayload.text.
 *   3. Парсить через `CheckinParserService` (LLM). confidence < 0.6 →
 *      сохраняем raw + curatorReview=true.
 *   4. Upsert в `DailyCheckIn` (через DailyCheckInService.upsertFromParser).
 *   5. Инвалидируем кэш COO дашборда.
 *
 * Контракт: best-effort. Любая ошибка → warn, не throw (не ломаем основной
 * pipeline respond-to-probe).
 */
@Injectable()
export class CheckinResponseHandler implements OnModuleInit {
  private readonly logger = new Logger(CheckinResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CheckinParserService) private readonly parser: CheckinParserService,
    @Inject(DailyCheckInService)
    private readonly checkinService: DailyCheckInService,
    @Inject(OperationsDashboardService)
    private readonly dashboard: OperationsDashboardService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // ТЗ 2026-05-29 telegram-self-initiated-checkins (Phase 4/5) —
    // нужен для закрытия pending `checkin.prompt` notification и для
    // отправки `checkin.ack` подтверждения. @Optional чтобы существующие
    // unit-тесты handler'а не падали при отсутствии mock'а.
    @Optional()
    @Inject(ConversationalService)
    private readonly conversational?: ConversationalService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.7 — подписка
   * на InboundMessage `daily_checkin_self`. Если ConversationalService
   * недоступен (legacy unit-тесты handler'а без @Global модуля) — деградация
   * молчаливая.
   */
  onModuleInit(): void {
    if (!this.conversational) {
      this.logger.warn(
        'CheckinResponseHandler.onModuleInit: ConversationalService недоступен — подписка на daily_checkin_self пропущена',
      );
      return;
    }
    this.conversational.subscribeInbound(
      'daily_checkin_self',
      async (msg: InboundMessage) => {
        if (msg.type !== 'daily_checkin_self') return;
        await this.processSelfInitiated({
          tenantId: msg.tenantId,
          userId: msg.userId,
          kind: msg.kind,
          rawText: msg.rawText,
          ...(msg.originChannelBindingId
            ? { originChannelBindingId: msg.originChannelBindingId }
            : {}),
        });
      },
    );
  }

  @OnEvent('notification.responded')
  async handle(event: {
    tenantId: string;
    notificationId: string;
    recipientUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Фильтр: только checkin.prompt + payload.metaJson.kind='checkin'.
      const isCheckin =
        event.eventType === 'checkin.prompt' ||
        (event.payload &&
          typeof event.payload === 'object' &&
          (event.payload as Record<string, unknown>).kind === 'checkin');
      if (!isCheckin) return;

      const notif = await this.prisma.notification.findUnique({
        where: { id: event.notificationId },
        select: { payload: true, recipientUserId: true, tenantId: true },
      });
      if (!notif) return;
      const origPayload = notif.payload as Record<string, unknown> | null;
      if (!origPayload) return;

      const kind = origPayload.checkInKind === 'evening' ? 'evening' : 'morning';
      const dateLocal =
        typeof origPayload.dateLocal === 'string' ? origPayload.dateLocal : null;
      const personId =
        typeof origPayload.personId === 'string' ? origPayload.personId : null;
      if (!dateLocal || !personId) {
        this.logger.debug(
          { notificationId: event.notificationId },
          'CheckinResponseHandler: payload без personId/dateLocal — skip',
        );
        return;
      }

      const rawText =
        typeof event.payload?.text === 'string'
          ? (event.payload.text as string)
          : typeof event.payload?.answer === 'string'
            ? (event.payload.answer as string)
            : '';

      const parsed = await this.parser.parse({
        tenantId: event.tenantId,
        kind,
        rawText,
      });

      const checkIn = await this.checkinService.upsertFromParser({
        tenantId: event.tenantId,
        personId,
        kind,
        dateLocal,
        plans: parsed.plans,
        dones: parsed.dones,
        blockers: parsed.blockers,
        notificationId: event.notificationId,
        rawResponseText: rawText,
        parseConfidence: parsed.confidence,
        source: 'cron_prompted',
      });

      if (parsed.confidence < 0.6) {
        this.metrics.incDailyCheckinSkipped({
          tenantTop: resolveOperationsTenantTop(event.tenantId),
          kind,
          reason: 'low_confidence',
        });
      }

      // SBA β-8.1 — после успешной сборки чек-ина эмитим событие, на которое
      // подписан `CheckinSentimentAnalyzerWorker`. Best-effort: ошибки
      // EventEmitter не ломают основной flow.
      try {
        this.eventEmitter?.emit('checkin.created', {
          tenantId: event.tenantId,
          checkInId: checkIn.id,
          personId,
          kind,
          rawText,
        });
      } catch (err) {
        this.logger.warn(
          {
            checkInId: checkIn.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'CheckinResponseHandler: EventEmitter.emit failed — продолжаю',
        );
      }

      await this.dashboard.invalidateCache(event.tenantId);
      this.logger.log(
        {
          tenantId: event.tenantId,
          personId,
          kind,
          dateLocal,
          confidence: parsed.confidence,
        },
        'CheckinResponseHandler: чек-ин сохранён',
      );
    } catch (err) {
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'CheckinResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }

  /**
   * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.8 — handler
   * для самоинициированных «план/отчёт» из бота. Зовётся из
   * `ConversationalService.dispatchInbound({type:'daily_checkin_self'})`
   * (см. Phase 5).
   *
   * Алгоритм:
   *   1. Резолвим Person по (tenantId, userId). Нет — outcome='no_person', return.
   *   2. Резолвим dateLocal по timezone Person'а.
   *   3. Проверяем hasCompletedToday — для wasReplace в подтверждении.
   *   4. Зовём CheckinParserService.parse(rawText).
   *   5. upsertFromParser(source='self_initiated') — ВСЕГДА, даже при
   *      parser confidence < 0.6 (симметрично cron-handler'у: curatorReview=true,
   *      raw в rawResponseText).
   *   6. Закрываем pending `checkin.prompt` notification(s) для (kind, dateLocal)
   *      через `markAsAnsweredByCheckin` (без эмиссии event'а).
   *   7. Эмитим `checkin.created` (для CheckinSentimentAnalyzerWorker).
   *   8. Отправляем `checkin.ack` notification с preferredChannelKinds=
   *      [resolveOriginChannelKind(originChannelBindingId)].
   *
   * Возвращает результат для метрик: outcome + low confidence flag.
   * НЕ throw — best-effort.
   */
  async processSelfInitiated(args: {
    tenantId: string;
    userId: string;
    kind: 'morning' | 'evening';
    rawText: string;
    originChannelBindingId?: string;
  }): Promise<{
    outcome:
      | 'saved'
      | 'low_parser_confidence_curator_review'
      | 'no_person'
      | 'no_membership'
      | 'error';
  }> {
    try {
      // 1. Резолв Person.
      const person = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.userId,
          deletedAt: null,
        },
        select: { id: true, timezone: true },
      });
      if (!person) {
        this.logger.warn(
          { tenantId: args.tenantId, userId: args.userId },
          'processSelfInitiated: нет Person для user в Org — skip',
        );
        return { outcome: 'no_person' };
      }

      // 2. Локальная дата по TZ Person'а.
      const now = new Date();
      const dateLocal = getLocalDate(now, person.timezone);

      // 3. hasCompletedToday — для wasReplace.
      const wasReplace = await this.checkinService.hasCompletedToday({
        tenantId: args.tenantId,
        personId: person.id,
        kind: args.kind,
        dateLocal,
      });

      // 4. Parse.
      const parsed = await this.parser.parse({
        tenantId: args.tenantId,
        kind: args.kind,
        rawText: args.rawText,
      });
      const lowConfidence = parsed.confidence < 0.6;

      // 5. Upsert — ВСЕГДА. Source='self_initiated'.
      const checkIn = await this.checkinService.upsertFromParser({
        tenantId: args.tenantId,
        personId: person.id,
        kind: args.kind,
        dateLocal,
        plans: parsed.plans,
        dones: parsed.dones,
        blockers: parsed.blockers,
        notificationId: null,
        rawResponseText: args.rawText,
        parseConfidence: parsed.confidence,
        source: 'self_initiated',
      });

      // 6. Закрываем pending checkin.prompt notification(s).
      if (this.conversational) {
        try {
          const pending = await this.prisma.notification.findMany({
            where: {
              tenantId: args.tenantId,
              recipientUserId: args.userId,
              eventType: 'checkin.prompt',
              responseStatus: 'pending',
            },
            select: { id: true, payload: true },
          });
          for (const n of pending) {
            const p = n.payload as Record<string, unknown> | null;
            if (
              p &&
              p.checkInKind === args.kind &&
              p.dateLocal === dateLocal
            ) {
              await this.conversational.markAsAnsweredByCheckin({
                notificationId: n.id,
                userId: args.userId,
                fromSelfInitiated: true,
              });
            }
          }
        } catch (err) {
          this.logger.warn(
            {
              tenantId: args.tenantId,
              userId: args.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'processSelfInitiated: ошибка при закрытии pending notification — продолжаю',
          );
        }
      }

      // 7. checkin.created event (для CheckinSentimentAnalyzerWorker).
      try {
        this.eventEmitter?.emit('checkin.created', {
          tenantId: args.tenantId,
          checkInId: checkIn.id,
          personId: person.id,
          kind: args.kind,
          rawText: args.rawText,
        });
      } catch (err) {
        this.logger.warn(
          {
            checkInId: checkIn.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'processSelfInitiated: EventEmitter.emit failed — продолжаю',
        );
      }

      // 8. checkin.ack notification (Phase 5).
      if (this.conversational) {
        try {
          const preferredKinds = await this.resolveOriginChannelKinds(
            args.originChannelBindingId,
            args.userId,
            args.tenantId,
          );
          await this.conversational.sendNotification({
            tenantId: args.tenantId,
            recipientUserId: args.userId,
            eventType: 'checkin.ack',
            payload: {
              kind: args.kind,
              wasReplace,
              plansCount: parsed.plans.length,
              donesCount: parsed.dones.length,
              blockersCount: parsed.blockers.length,
              lowParserConfidence: lowConfidence,
            },
            dataClass: 'internal',
            ...(preferredKinds.length > 0
              ? { preferredChannelKinds: preferredKinds }
              : {}),
          });
        } catch (err) {
          this.logger.warn(
            {
              tenantId: args.tenantId,
              userId: args.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'processSelfInitiated: sendNotification(checkin.ack) failed — продолжаю',
          );
        }
      }

      await this.dashboard.invalidateCache(args.tenantId);
      const outcome: 'saved' | 'low_parser_confidence_curator_review' =
        lowConfidence ? 'low_parser_confidence_curator_review' : 'saved';
      this.metrics.incBotDailyCheckinSelf({
        channel: 'telegram_bot',
        kind: args.kind,
        outcome,
      });
      this.logger.log(
        {
          tenantId: args.tenantId,
          personId: person.id,
          kind: args.kind,
          dateLocal,
          confidence: parsed.confidence,
          wasReplace,
        },
        'processSelfInitiated: чек-ин сохранён',
      );
      return { outcome };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          userId: args.userId,
          kind: args.kind,
          err: err instanceof Error ? err.message : String(err),
        },
        'processSelfInitiated: внутренняя ошибка',
      );
      this.metrics.incBotDailyCheckinSelf({
        channel: 'telegram_bot',
        kind: args.kind,
        outcome: 'error',
      });
      return { outcome: 'error' };
    }
  }

  /**
   * Резолвит `kind` канала по `originChannelBindingId` (если задан и принадлежит
   * recipient + tenant). Возвращает [kind] для preferredChannelKinds, либо
   * пустой массив (тогда работает default-policy для checkin.ack).
   */
  private async resolveOriginChannelKinds(
    originChannelBindingId: string | undefined,
    userId: string,
    tenantId: string,
  ): Promise<Array<'telegram_bot' | 'max_bot' | 'in_app' | 'email_smtp'>> {
    if (!originChannelBindingId) return [];
    const binding = await this.prisma.channelBinding.findUnique({
      where: { id: originChannelBindingId },
      include: { channel: true },
    });
    if (!binding) return [];
    if (binding.userId !== userId) return [];
    if (binding.channel.tenantId && binding.channel.tenantId !== tenantId) {
      return [];
    }
    const kind = binding.channel.kind;
    if (
      kind === 'telegram_bot' ||
      kind === 'max_bot' ||
      kind === 'in_app' ||
      kind === 'email_smtp'
    ) {
      return [kind];
    }
    return [];
  }
}

