import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import { MeetingIngestAdapter } from './adapters/meeting.adapter';

/**
 * Ф7 МТЗ «разблокировка конвейера» (баг #1/#8) — reingest-fallback.
 *
 * Корень: `ingestMeeting` — ЕДИНСТВЕННЫЙ вход результата встречи в
 * knowledge-core (analyze.worker → MeetingIngestAdapter после ai_ready).
 * Если ingest провалился (source_inactive / quota 429 / транзиентная ошибка),
 * встреча так и остаётся БЕЗ `RawEvent(sourceExternalId=meetingId)` — в граф
 * ничего не уходит. analyze.worker теперь делает провал видимым
 * (failureReason + метрика), но НЕ ретраит ingest сам.
 *
 * Этот cron — recovery-петля: каждые 15 минут ищет встречи с готовым
 * транскриптом (`Transcript.turns != null`), но без `RawEvent(meeting)`, и
 * best-effort переигрывает `ingestMeeting`. Идемпотентность гарантирует
 * `IngestService` (idempotencyKey по sourceExternalId) — повторный заход не
 * плодит RawEvent. Каждая встреча в своём try/catch: одна упавшая не валит
 * остальные. На провале — лог + метрика `meeting_ingest_failed{reason}`.
 *
 * Расписание — литерал `*\/15 * * * *` (как invoice-status-sync.cron). Cron
 * статичен; перерегистрация через SchedulerRegistry — vNext.
 */
@Injectable()
export class MeetingReingestCron {
  private readonly logger = new Logger(MeetingReingestCron.name);
  private running = false;

  /** Сколько кандидатов разбираем за один проход (не перегружаем pipeline). */
  private static readonly BATCH_SIZE = 50;
  /** Окно поиска кандидатов — последние N дней (свежие застрявшие встречи). */
  private static readonly LOOKBACK_DAYS = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingIngestAdapter) private readonly meetingIngest: MeetingIngestAdapter,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'meeting-reingest' })
  async sweep(): Promise<void> {
    if (this.running) {
      // Не запускаем второй экземпляр пока предыдущий не закончил.
      this.logger.debug('meeting-reingest.cron: prev run in progress, skip');
      return;
    }
    this.running = true;
    try {
      const since = new Date(
        Date.now() - MeetingReingestCron.LOOKBACK_DAYS * 24 * 3600 * 1000,
      );

      // Кандидаты: встречи с готовым транскриптом (turns != null) за окно
      // LOOKBACK_DAYS. take ограничивает batch. tenantId здесь NOT NULL по
      // схеме, но фильтр-наличие RawEvent проверяем per-candidate ниже.
      // JSON-поле IS NOT NULL фильтруем через `not: Prisma.AnyNull` (Prisma 7;
      // парный к `equals: Prisma.AnyNull` для IS NULL, см. meeting-speaker-
      // analyzer.worker). status='ai_ready' — после analyze, до ingest.
      const candidates = await this.prisma.meeting.findMany({
        where: {
          createdAt: { gte: since },
          status: 'ai_ready',
          transcript: { is: { turns: { not: Prisma.AnyNull } } },
        },
        select: { id: true, tenantId: true },
        orderBy: { createdAt: 'desc' },
        take: MeetingReingestCron.BATCH_SIZE,
      });

      let reingested = 0;
      let skipped = 0;
      let failed = 0;

      for (const meeting of candidates) {
        // «Нет RawEvent(sourceExternalId=meetingId)» — per-candidate findFirst.
        // sourceType='meeting' сужает до meeting-источника (sourceExternalId =
        // meetingId именно у meeting-адаптера).
        const existing = await this.prisma.rawEvent.findFirst({
          where: { sourceExternalId: meeting.id, sourceType: 'meeting' },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }

        try {
          await this.meetingIngest.ingestMeeting(meeting.id);
          reingested++;
          this.logger.debug(
            { meetingId: meeting.id, tenantId: meeting.tenantId },
            'meeting-reingest.cron: встреча переигран в knowledge-core',
          );
        } catch (err) {
          failed++;
          const reason = classifyReingestFailure(err);
          this.metrics.incIngestFailed({ reason });
          this.logger.warn(
            {
              meetingId: meeting.id,
              tenantId: meeting.tenantId,
              reason,
              err: err instanceof Error ? err.message : String(err),
            },
            'meeting-reingest.cron: ingestMeeting упал — продолжаем со следующей',
          );
        }
      }

      if (reingested > 0 || failed > 0) {
        this.logger.debug(
          { candidates: candidates.length, reingested, skipped, failed },
          'meeting-reingest.cron: проход завершён',
        );
      } else {
        this.logger.debug(
          { candidates: candidates.length, skipped },
          'meeting-reingest.cron: нечего переигрывать',
        );
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'meeting-reingest.cron: проход упал',
      );
    } finally {
      this.running = false;
    }
  }
}

/**
 * Классификация провала reingest для метрики `meeting_ingest_failed{reason}`.
 * Совпадает по reason'ам с analyze.worker (source_inactive / no_merged_transcript
 * / without_tenant / quota_exceeded / other), читая `error.code` из тела
 * NestJS HttpException, QuotaExceededError — по `err.name`, иначе substring.
 */
function classifyReingestFailure(err: unknown): string {
  const code = extractErrorCode(err);
  switch (code) {
    case 'source_inactive':
      return 'source_inactive';
    case 'meeting_no_merged_transcript':
      return 'no_merged_transcript';
    case 'meeting_without_tenant':
      return 'without_tenant';
    case 'quota_exceeded':
      return 'quota_exceeded';
    default:
      break;
  }
  if (err instanceof Error && err.name === 'QuotaExceededError') {
    return 'quota_exceeded';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('source_inactive') || msg.includes('Source отключён')) return 'source_inactive';
  if (msg.includes('meeting_no_merged_transcript')) return 'no_merged_transcript';
  if (msg.includes('meeting_without_tenant')) return 'without_tenant';
  if (msg.includes('quota_exceeded')) return 'quota_exceeded';
  return 'other';
}

function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const candidates: unknown[] = [];
  const maybeGet = (err as { getResponse?: () => unknown }).getResponse;
  if (typeof maybeGet === 'function') {
    try {
      candidates.push(maybeGet.call(err));
    } catch {
      /* noop */
    }
  }
  candidates.push((err as { response?: unknown }).response);
  for (const body of candidates) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof code === 'string') return code;
  }
  return null;
}
