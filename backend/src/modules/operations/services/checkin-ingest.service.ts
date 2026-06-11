import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';

/**
 * CheckinIngestService — мост ежедневный чек-ин → knowledge-core
 * (ТЗ plans/tz/2026-06-10-daily-checkin-to-graph-bridge.md, Фаза 2).
 *
 * Завершённый чек-ин (`DailyCheckIn.completedAt != null`) превращает в один
 * `RawEvent(sourceType='daily_checkin')` через `IngestService.ingest` — дальше
 * его подхватывает block-ingest worker knowledge-core (мы его НЕ трогаем).
 * Payload содержит `fullText` (структурный рендер плана/сделанного/блокеров)
 * и `transcript.turns` с `authorPersonId` сотрудника — block-ingest пишет
 * subject по автору сегмента (та же per-turn атрибуция, что у chatbox).
 *
 * Эталон — `ChatboxIngestService.ingestSession`: тот же `IngestService.ingest`,
 * idempotency по `sourceExternalId`, lazy `upsertSource`, `dataClass='sensitive'`.
 *
 * НЕ ингестим оценочный слой COO: `sentiment` / `sentimentRationale` /
 * `qualityScore` (Р-B2 / R5) — поля даже не читаем из БД.
 *
 * Анти-инъекция: payload.fullText хранится СЫРЫМ, без `applyInputGuards`
 * (паритет с эталоном chatbox — он тоже не оборачивает payload в data-маркеры;
 * у моста нет собственного LLM-вызова, поэтому пары (system,user) для guard'ов
 * не существует, а downstream block-ingest применяет input-guards к user-части
 * при извлечении). Pre-wrap здесь задвоил бы DATA-маркеры в текст сегмента
 * (segment-builder.tryGetFullText берёт fullText как единый сегмент).
 *
 * Зависимости (все @Global, в imports модуля не нужны):
 *   - PrismaService (PrismaModule @Global).
 *   - IngestService (IngestModule @Global, exports IngestService).
 */

const SOURCE_TYPE = 'daily_checkin' as const;
const SOURCE_NAME = 'Ежедневные чек-ины' as const;

/** Один пункт чек-ина (plan/done/blocker) после безопасного парса Json-поля. */
export interface CheckinItem {
  text: string;
  /** Только у блокеров: low|medium|high (свободная строка — не доверяем). */
  severity?: string;
}

const SEVERITY_RU: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
};

/**
 * Безопасно извлекает массив пунктов из Json-поля чек-ина
 * (`plansJson` / `donesJson` / `blockersJson` — `Array<{ text, ... }>`).
 * Игнорирует не-массивы, элементы без строкового `text` и пустые строки.
 */
export function extractCheckinItems(json: unknown): CheckinItem[] {
  if (!Array.isArray(json)) return [];
  const out: CheckinItem[] = [];
  for (const el of json) {
    if (!el || typeof el !== 'object') continue;
    const rec = el as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!text) continue;
    const severity =
      typeof rec.severity === 'string' ? rec.severity : undefined;
    out.push(severity ? { text, severity } : { text });
  }
  return out;
}

export interface RenderCheckinInput {
  personName: string;
  dateLocal: string;
  /** 'morning' | 'evening' (литерал строкой в схеме). */
  kind: string;
  plans: CheckinItem[];
  dones: CheckinItem[];
  blockers: CheckinItem[];
  rawResponseText: string | null;
}

/**
 * Чистый рендер чек-ина в `fullText` (для unit-теста и payload). Заголовок с
 * автором/датой/типом — всегда (контекст для block-ingest, Р-B4). Дальше —
 * структурные секции для непустых plan/done/blocker. Если структура целиком
 * пуста (низкая уверенность парсера, Р-B1) — тело = `rawResponseText`.
 */
export function renderCheckinText(input: RenderCheckinInput): string {
  const kindLabel =
    input.kind === 'morning' ? 'утренний план' : 'вечерний отчёт';
  const lines: string[] = [
    `Чек-ин сотрудника ${input.personName}, ${input.dateLocal}, ${kindLabel}.`,
  ];
  const hasStructure =
    input.plans.length > 0 ||
    input.dones.length > 0 ||
    input.blockers.length > 0;
  if (hasStructure) {
    if (input.plans.length > 0) {
      lines.push('План на день:');
      for (const p of input.plans) lines.push(`- ${p.text}`);
    }
    if (input.dones.length > 0) {
      lines.push('Сделано:');
      for (const d of input.dones) lines.push(`- ${d.text}`);
    }
    if (input.blockers.length > 0) {
      lines.push('Блокеры:');
      for (const b of input.blockers) {
        const sev = b.severity
          ? ` (важность: ${SEVERITY_RU[b.severity] ?? b.severity})`
          : '';
        lines.push(`- ${b.text}${sev}`);
      }
    }
  } else if (input.rawResponseText && input.rawResponseText.trim()) {
    lines.push(input.rawResponseText.trim());
  }
  return lines.join('\n');
}

/**
 * Стабильный `occurredAt` из `dateLocal` (YYYY-MM-DD) — полдень UTC того дня.
 *
 * ⚠️ Эмпирически проверено (daily-checkin.service.ts:316): `completedAt`
 * переписывается `new Date()` на КАЖДОМ upsert'е (вкл. ветку update при
 * replace чек-ина того же дня). `IngestService.ingest` при совпадении
 * idempotencyKey возвращает существующий RawEvent и payload НЕ обновляет.
 * Если бы `occurredAt = completedAt`, replace менял бы idempotencyKey → дубль
 * RawEvent (нарушение R3 «ровно один RawEvent на чек-ин»). Поэтому берём
 * `dateLocal` — он входит в unique-ключ `(tenantId,personId,kind,dateLocal)`,
 * неизменен по checkInId и семантически = рабочий день (ось темпорального
 * retrieval «на этой неделе», R8 — даже точнее, чем поздневечерний completedAt).
 *
 * Следствие v1: replace того же дня = no-op (первый завершённый чек-ин = канон,
 * в граф доезжает первая версия). Известное ограничение — в реестре
 * `04_не-сделано`; re-ingest при replace — отдельный vNext-ТЗ.
 *
 * Невалидный `dateLocal` → fallback на переданный completedAt.
 */
export function checkinOccurredAt(dateLocal: string, fallback: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return fallback;
  const d = new Date(`${dateLocal}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

@Injectable()
export class CheckinIngestService {
  private readonly logger = new Logger(CheckinIngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  /**
   * Lazy upsert `Source(type='daily_checkin', name='Ежедневные чек-ины')` для
   * tenant'а. Конкурентно-безопасен (try/catch на P2002 → повторный
   * findUnique). Копия паттерна `ChatboxIngestService.upsertSource`.
   */
  private async upsertSource(tenantId: string): Promise<{ id: string }> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: { tenantId, type: SOURCE_TYPE, name: SOURCE_NAME },
      },
      select: { id: true },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: SOURCE_TYPE,
          name: SOURCE_NAME,
          dataClass: 'sensitive',
          isActive: true,
        },
        select: { id: true },
      });
    } catch (err) {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: SOURCE_TYPE,
            name: SOURCE_NAME,
          },
        },
        select: { id: true },
      });
      if (retry) return retry;
      throw err;
    }
  }

  /**
   * Завершённый чек-ин → `RawEvent(sourceType='daily_checkin')` через
   * `IngestService.ingest`. Идемпотентно по `sourceExternalId=checkInId`
   * (R3). Возвращает `{ rawEventId }` или `null` (чек-ин не найден / ещё не
   * заполнен `completedAt=null` — «пустой», не ингестим, R2).
   */
  async ingestCheckin(
    tenantId: string,
    checkInId: string,
  ): Promise<{ rawEventId: string } | null> {
    const checkIn = await this.prisma.dailyCheckIn.findFirst({
      where: { id: checkInId, tenantId },
      select: {
        id: true,
        personId: true,
        kind: true,
        dateLocal: true,
        plansJson: true,
        donesJson: true,
        blockersJson: true,
        rawResponseText: true,
        curatorReview: true,
        completedAt: true,
        // НЕ читаем sentiment/sentimentRationale/qualityScore (Р-B2 / R5).
      },
    });
    // R2: пустой (completedAt=null) / отсутствующий чек-ин — не ингестим.
    if (!checkIn || checkIn.completedAt === null) return null;

    const person = await this.prisma.person.findFirst({
      where: { id: checkIn.personId, tenantId },
      select: { name: true },
    });
    const personName = person?.name ?? 'сотрудник';

    const plans = extractCheckinItems(checkIn.plansJson);
    const dones = extractCheckinItems(checkIn.donesJson);
    const blockers = extractCheckinItems(checkIn.blockersJson);

    const fullText = renderCheckinText({
      personName,
      dateLocal: checkIn.dateLocal,
      kind: checkIn.kind,
      plans,
      dones,
      blockers,
      rawResponseText: checkIn.rawResponseText,
    });

    // Один turn = всё тело чек-ина с authorPersonId сотрудника. block-ingest
    // (attributeSubject) пишет subject по автору сегмента (R4). Синтетические
    // таймкоды (как у chatbox) дают buildSegments стабильную привязку.
    const transcriptTurns = [
      {
        speaker: personName,
        text: fullText,
        startSec: 0,
        endSec: 1,
        speakerParticipantId: null,
        authorPersonId: checkIn.personId,
      },
    ];

    const payload = {
      kind: 'daily_checkin' as const,
      checkInId: checkIn.id,
      checkInKind: checkIn.kind,
      dateLocal: checkIn.dateLocal,
      personId: checkIn.personId,
      personName,
      curatorReview: checkIn.curatorReview,
      // Обязательно для block-ingest (generic-путь ищет fullText).
      fullText,
      // Per-turn атрибуция автора (subject = сотрудник).
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);

    // occurredAt — стабильный (см. checkinOccurredAt): R8 темпоральная ось +
    // R3 неизменный idempotencyKey. completedAt здесь точно не null.
    const occurredAt = checkinOccurredAt(checkIn.dateLocal, checkIn.completedAt);

    const res = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: checkInId, // R3: идемпотентность по checkInId
      occurredAt,
      payload,
      dataClass: 'sensitive', // R7 (Р-B3)
    });

    return { rawEventId: res.rawEvent.id };
  }
}
