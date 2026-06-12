import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  IngestService,
  type IngestResult,
} from '../ingest.service';

import {
  mapStructuredToReportFacts,
  type ReportFact,
} from './report-fact-mapper';

/** Глава fast-отчёта в payload (минимальная проекция MeetingChapter). */
interface ReportChapterPayload {
  title: string;
  summary: string;
}

/**
 * Адаптер источника `meeting_report` — ВТОРИЧНЫЙ путь в граф знаний
 * (knowledge-core). Главная точка входа — `ingestReport(meetingId)`.
 *
 * Отличие от `MeetingIngestAdapter` (первичный, транскрипт):
 *   - читает ГОТОВЫЙ fast-отчёт (summaryFast + структурные выводы по типу
 *     встречи + главы), а не сырой транскрипт;
 *   - создаёт ОТДЕЛЬНЫЙ `RawEvent` через отдельный `Source(type=meeting_report)`,
 *     так `IdeaBlockEvidence.sourceType` бесплатно становится 'meeting_report',
 *     а блоки помечаются `primarySource='report'` (ГАРД A, Фаза 4) — вторичный
 *     по весу источник, не «перехватывает» canonical у транскрипта;
 *   - НИКОГДА не заносит клиентский протокол `client_protocol_md` (граница
 *     конфиденциальности D6 — см. report-fact-mapper.ts whitelist).
 *
 * Best-effort: вызывается из `ReportIngestListener` по событию
 * `meeting.report-fast-ready`. Если встреча/tenant отсутствует — возвращает
 * null (не бросает), listener это терпит.
 *
 * Идемпотентность: `sourceExternalId = 'report_' + meetingId`,
 * `occurredAt = meeting.endedAt` (СТАБИЛЕН — НЕ reportFastGeneratedAt) →
 * повторный 'ready'/ре-эмит/BullMQ-retry даёт тот же idempotencyKey.
 *
 * См. plans/tz/2026-06-11-report-to-graph-phase2.md §2.1, §2.4, §4.
 */
@Injectable()
export class ReportIngestAdapter {
  private readonly logger = new Logger(ReportIngestAdapter.name);

  /** Канонический name дефолтного meeting_report-Source для каждой Org. */
  static readonly DEFAULT_SOURCE_NAME = 'Отчёты встреч Z';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  /**
   * Ingest готового fast-отчёта одной встречи. Идемпотентен. Best-effort:
   * при отсутствии данных возвращает null (не бросает).
   */
  async ingestReport(meetingId: string): Promise<IngestResult | null> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        tenantId: true,
        type: true,
        title: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        aiResult: { select: { summaryFast: true, structuredData: true } },
      },
    });
    if (!meeting) {
      this.logger.debug({ meetingId }, 'report-adapter: meeting не найден — skip');
      return null;
    }
    if (!meeting.tenantId) {
      // legacy / повреждённая встреча без Org — заносить некуда (best-effort).
      this.logger.warn(
        { meetingId },
        'report-adapter: meeting без tenantId — skip',
      );
      return null;
    }
    const tenantId = meeting.tenantId;

    // 1. Главы fast-отчёта (см. meeting-report-fast.worker.ts writeChapters:
    //    MeetingChapter с extractorVersion='fast').
    const chapterRows = await this.prisma.meetingChapter.findMany({
      where: { meetingId, extractorVersion: 'fast' },
      orderBy: { order: 'asc' },
      select: { title: true, summary: true },
    });
    const chapters: ReportChapterPayload[] = chapterRows
      .filter((c) => c.title.trim().length > 0)
      .map((c) => ({ title: c.title, summary: c.summary ?? '' }));

    // 2. summaryFast (быстрое саммари; полиморфно не зависит от типа).
    const reportSummaryMarkdown = (meeting.aiResult?.summaryFast ?? '').trim();

    // 3. Структурные факты по типу встречи (whitelist; D6 — без protocol_md).
    const reportFacts: ReportFact[] = mapStructuredToReportFacts(
      meeting.type,
      meeting.aiResult?.structuredData,
    );

    // 4. Нечего заносить — RawEvent НЕ создаём. Учитываем ВСЕ три источника
    //    сегментов (факты / summary / главы): схема fast-отчёта допускает
    //    пустой summary_markdown при непустых chapters (главы и summary —
    //    независимые поля одного LLM-ответа), а маппер покрывает лишь 4 из 12
    //    типов встреч → reportFacts часто пуст. Без проверки chapters.length
    //    кейс «главы есть, summary+факты пусты» терял бы узлы-главы из графа.
    if (
      reportFacts.length === 0 &&
      reportSummaryMarkdown.length === 0 &&
      chapters.length === 0
    ) {
      this.logger.debug(
        { meetingId, tenantId },
        'report-adapter: пустой отчёт (нет фактов, summary и глав) — RawEvent не создаём',
      );
      return null;
    }

    // 5. lazy-upsert отдельного Source(type=meeting_report) для tenant.
    const source = await this.upsertDefaultReportSource(tenantId);

    // 6. payload (Json без enum-ограничений).
    const payload = {
      kind: 'meeting_report' as const,
      meetingId: meeting.id,
      meetingType: meeting.type,
      reportSummaryMarkdown,
      chapters,
      reportFacts,
    };

    // 7. occurredAt = endedAt (СТАБИЛЕН) — детерминированный idempotencyKey.
    const occurredAt =
      meeting.endedAt ?? meeting.startedAt ?? meeting.createdAt;

    const result = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      // Суффикс 'report_' ОБЯЗАТЕЛЕН — иначе ключ совпал бы с транскриптным
      // RawEvent (тот же occurredAt + тот же meetingId).
      sourceExternalId: `report_${meeting.id}`,
      occurredAt,
      payload,
      dataClass: 'internal',
    });

    this.logger.log(
      {
        meetingId: meeting.id,
        tenantId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
        factsCount: reportFacts.length,
        chaptersCount: chapters.length,
      },
      'report-adapter: ingest завершён',
    );
    return result;
  }

  /**
   * Создаёт (если нет) или возвращает дефолтный `Source(type=meeting_report)`
   * для tenant. Конкурентно-безопасен через try/catch на P2002-гонке
   * (паттерн MeetingIngestAdapter.upsertDefaultMeetingSource).
   */
  async upsertDefaultReportSource(tenantId: string) {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'meeting_report',
          name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;

    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'meeting_report',
          name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch (err) {
      // Гонка: между findUnique и create кто-то создал — повторим findUnique.
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'meeting_report',
            name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw err;
    }
  }
}
