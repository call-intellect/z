import type { RawEvent, Source } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IngestService } from '../ingest.service';

import { ReportIngestAdapter } from './report.adapter';

/**
 * Юнит-тесты ReportIngestAdapter (Фаза 2 «отчёт встречи → граф»,
 * ТЗ 2026-06-11-report-to-graph-phase2.md §2.1, §4).
 *
 * Покрытие:
 *   1. Нет встречи / нет tenantId → null (best-effort, не бросает).
 *   2. Пустой отчёт (нет фактов И нет summary) → null (RawEvent НЕ создаём).
 *   3. sourceExternalId = 'report_<id>', occurredAt = endedAt (стабилен),
 *      dataClass='internal', payload.kind='meeting_report'.
 *   4. Lazy upsert Source(type=meeting_report).
 */
describe('ReportIngestAdapter', () => {
  let prisma: PrismaService;
  let ingest: IngestService;
  let adapter: ReportIngestAdapter;

  let meetingFindUnique: ReturnType<typeof vi.fn>;
  let chapterFindMany: ReturnType<typeof vi.fn>;
  let sourceFindUnique: ReturnType<typeof vi.fn>;
  let sourceCreate: ReturnType<typeof vi.fn>;
  let ingestFn: ReturnType<typeof vi.fn>;

  const fakeSource: Source = {
    id: 'src_report_1',
    tenantId: 'org_1',
    type: 'meeting_report',
    name: 'Отчёты встреч Z',
    dataClass: 'internal',
    isActive: true,
  } as unknown as Source;

  const fakeRawEvent: RawEvent = {
    id: 're_report_1',
    tenantId: 'org_1',
    sourceId: 'src_report_1',
    sourceType: 'meeting_report',
    sourceExternalId: 'report_m1',
    processingStatus: 'received',
  } as unknown as RawEvent;

  const endedAt = new Date('2026-06-11T10:00:00.000Z');

  beforeEach(() => {
    meetingFindUnique = vi.fn();
    chapterFindMany = vi.fn().mockResolvedValue([]);
    sourceFindUnique = vi.fn().mockResolvedValue(fakeSource);
    sourceCreate = vi.fn().mockResolvedValue(fakeSource);
    ingestFn = vi
      .fn()
      .mockResolvedValue({ rawEvent: fakeRawEvent, idempotent: false });

    prisma = {
      meeting: { findUnique: meetingFindUnique },
      meetingChapter: { findMany: chapterFindMany },
      source: { findUnique: sourceFindUnique, create: sourceCreate },
    } as unknown as PrismaService;
    ingest = { ingest: ingestFn } as unknown as IngestService;
    adapter = new ReportIngestAdapter(prisma, ingest);
  });

  it('нет встречи → null, ingest НЕ вызывается', async () => {
    meetingFindUnique.mockResolvedValue(null);
    const res = await adapter.ingestReport('m1');
    expect(res).toBeNull();
    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('встреча без tenantId → null (best-effort)', async () => {
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: null,
      type: 'team',
      aiResult: { summaryFast: 'итоги', structuredData: {} },
    });
    const res = await adapter.ingestReport('m1');
    expect(res).toBeNull();
    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('пустой отчёт (нет фактов, summary И глав) → null, RawEvent НЕ создаём', async () => {
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: 'org_1',
      type: 'team',
      title: 'Встреча',
      startedAt: null,
      endedAt,
      createdAt: endedAt,
      aiResult: { summaryFast: '', structuredData: { discussed: [] } },
    });
    chapterFindMany.mockResolvedValue([]);
    const res = await adapter.ingestReport('m1');
    expect(res).toBeNull();
    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('главы есть, но summary+факты пусты → RawEvent СОЗДАЁТСЯ (главы — узлы графа, не теряем)', async () => {
    // Регресс-тест на находку ревью Фазы 2: гард не должен игнорировать
    // chapters.length. Схема fast-отчёта допускает пустой summary при непустых
    // главах; маппер «team» без нужных полей → reportFacts=[].
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: 'org_1',
      type: 'team',
      title: 'Встреча',
      startedAt: null,
      endedAt,
      createdAt: endedAt,
      aiResult: { summaryFast: '', structuredData: { discussed: [] } },
    });
    chapterFindMany.mockResolvedValue([
      { title: 'Вступление', summary: 'Повестка встречи' },
    ]);
    const res = await adapter.ingestReport('m1');
    expect(res).not.toBeNull();
    expect(ingestFn).toHaveBeenCalledTimes(1);
    const payload = ingestFn.mock.calls[0]?.[0]?.payload as { chapters?: unknown[] };
    expect(payload.chapters).toHaveLength(1);
  });

  it('есть структурные факты → ingest с sourceExternalId=report_<id>, occurredAt=endedAt, kind=meeting_report', async () => {
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: 'org_1',
      type: 'team',
      title: 'Командная встреча',
      startedAt: new Date('2026-06-11T09:00:00.000Z'),
      endedAt,
      createdAt: new Date('2026-06-11T08:00:00.000Z'),
      aiResult: {
        summaryFast: 'Итоги: договорились о релизе',
        structuredData: {
          decisions: [{ text: 'Релиз 15 июня', speaker: 'Алиса', changes_what: null }],
          blockers: ['Нет инфры'],
          tasks: [{ title: 'Сделать демо', assignee: null, dueDate: null }],
          next_step: 'собраться в пятницу',
        },
      },
    });
    chapterFindMany.mockResolvedValue([
      { title: 'Обсуждение', summary: 'Поговорили' },
    ]);

    const res = await adapter.ingestReport('m1');

    expect(res).not.toBeNull();
    expect(ingestFn).toHaveBeenCalledTimes(1);
    const arg = ingestFn.mock.calls[0]![0];
    expect(arg.tenantId).toBe('org_1');
    expect(arg.sourceId).toBe('src_report_1');
    // Суффикс report_ ОБЯЗАТЕЛЕН (иначе конфликт с транскриптным RawEvent).
    expect(arg.sourceExternalId).toBe('report_m1');
    // occurredAt = endedAt (СТАБИЛЕН), не now/generatedAt.
    expect(arg.occurredAt).toBe(endedAt);
    expect(arg.dataClass).toBe('internal');
    expect(arg.payload.kind).toBe('meeting_report');
    expect(arg.payload.meetingId).toBe('m1');
    expect(arg.payload.meetingType).toBe('team');
    expect(arg.payload.reportSummaryMarkdown).toBe('Итоги: договорились о релизе');
    expect(arg.payload.chapters).toEqual([
      { title: 'Обсуждение', summary: 'Поговорили' },
    ]);
    // Факты разложены гранулярно.
    expect(arg.payload.reportFacts).toContainEqual({
      reportKind: 'decision',
      text: 'Релиз 15 июня',
      speaker: 'Алиса',
    });
    expect(arg.payload.reportFacts).toContainEqual({
      reportKind: 'task',
      text: 'Сделать демо',
    });
  });

  it('только summary (нет структурных фактов) → ingest всё равно создаётся', async () => {
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: 'org_1',
      type: 'interview', // тип вне whitelist → структурных фактов нет
      title: 'Интервью',
      startedAt: null,
      endedAt,
      createdAt: endedAt,
      aiResult: { summaryFast: 'Краткое саммари', structuredData: { whatever: 1 } },
    });
    chapterFindMany.mockResolvedValue([]);

    const res = await adapter.ingestReport('m1');

    expect(res).not.toBeNull();
    expect(ingestFn).toHaveBeenCalledTimes(1);
    const arg = ingestFn.mock.calls[0]![0];
    expect(arg.payload.reportFacts).toEqual([]);
    expect(arg.payload.reportSummaryMarkdown).toBe('Краткое саммари');
  });

  it('D6: client_protocol_md в structuredData НЕ попадает в payload (sales)', async () => {
    const protocol = 'Нейтральный протокол для клиента';
    meetingFindUnique.mockResolvedValue({
      id: 'm1',
      tenantId: 'org_1',
      type: 'sales',
      title: 'Продажа',
      startedAt: null,
      endedAt,
      createdAt: endedAt,
      aiResult: {
        summaryFast: 'Саммари продажи',
        structuredData: {
          pain: 'Теряют заявки',
          objections: ['Дорого'],
          next_step: 'дождаться',
          client_protocol_md: protocol,
        },
      },
    });
    chapterFindMany.mockResolvedValue([]);

    await adapter.ingestReport('m1');

    const arg = ingestFn.mock.calls[0]![0];
    const serialized = JSON.stringify(arg.payload);
    expect(serialized).not.toContain('Нейтральный протокол');
    expect(serialized).not.toContain('client_protocol');
  });
});
