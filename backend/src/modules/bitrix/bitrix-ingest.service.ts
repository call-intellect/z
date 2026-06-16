import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { IngestService } from '../ingest/ingest.service';

import { CRM_BACKFILL_DAYS } from './bitrix-sync.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Сколько закрытых дней максимум дайджестим за один проход (анти-бёрст). */
const MAX_DIGEST_DAYS_PER_RUN = CRM_BACKFILL_DAYS;

/** Начало UTC-суток для даты. */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Секция дайджеста: `Заголовок (N):\n- …`. Пустая → ''. */
function digestSection(label: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return `${label} (${lines.length}):\n${lines.map((x) => `- ${x}`).join('\n')}\n\n`;
}

/**
 * BitrixIngestService — мост Bitrix24 (внутренний IM) → knowledge-core
 * (ТЗ plans/tz/2026-06-17-bitrix24-source-sync.md, Ф4). По образцу
 * `ChatboxIngestService`, с двумя отличиями под пересмотр 2026-06-17:
 *
 * 1. **Сессия = сутки** (`BitrixDialogSession`, закрывается в `rebuildDialogSessions`).
 *    Анализируем только закрытые сессии (`endedAt != null`).
 * 2. **Посуточное саммари + накопительный контекст** — ОДИН LLM-вызов на
 *    закрытие дня: вход = `накопительное саммари диалога (rollingSummary)` +
 *    `сообщения дня`, выход = `{ daySummary, rollingSummary }`. `daySummary`
 *    кладём в `BitrixDialogSession.summary`; обновлённое `rollingSummary`
 *    (+ `rollingSummaryAt`) — на `BitrixDialog`. Никогда не гоним всю историю —
 *    только дельту дня поверх компактного накопительного.
 *
 * Обе стороны IM-диалога — сотрудники (Bitrix users). Атрибуция subject в графе
 * идёт по `BitrixUser.linkedPersonId` автора каждой реплики (`transcript.turns
 * [*].authorPersonId`). Без линковки сотрудника на Person граф построится, но
 * блоки не привяжутся к человеку.
 *
 * Зависимости (все @Global, в imports модуля не нужны):
 *   - PrismaService (PrismaModule @Global).
 *   - IngestService (IngestModule @Global, exports IngestService).
 *   - LlmRouterService (AiModule @Global, exports LlmRouterService).
 */

const SOURCE_TYPE = 'bitrix' as const;
const SOURCE_NAME = 'Bitrix24' as const;

/**
 * System-промпт посуточного rollup'а. Захардкожен константой (как
 * `SUMMARY_SYSTEM_PROMPT` в chatbox-ingest) — не через prompt-registry. Просит
 * СТРОГО валидный JSON с двумя строковыми полями (плейн-текст + `validate`
 * надёжнее strict-json_schema на anthropic, см. llm-router gotchas).
 */
const DAY_ROLLUP_SYSTEM_PROMPT = [
  'Ты — аналитик внутренних рабочих переписок сотрудников компании.',
  'Тебе дают НАКОПИТЕЛЬНОЕ САММАРИ диалога (контекст прошлых дней, может быть пустым)',
  'и СООБЩЕНИЯ ЗА ОДИН ДЕНЬ.',
  'Верни СТРОГО валидный JSON без markdown и пояснений, ровно с двумя строковыми полями:',
  '{"daySummary": "...", "rollingSummary": "..."}',
  '- daySummary — что произошло именно в этот день: ключевые темы, решения,',
  '  договорённости, открытые вопросы. 3-6 предложений, по-русски.',
  '- rollingSummary — ОБНОВЛЁННОЕ накопительное саммари всего диалога: объедини',
  '  прошлый контекст с событиями дня, убери устаревшее, держи компактным',
  '  (до ~10 предложений), по-русски. Если накопительного нет — построй с нуля.',
].join(' ');

/** Результат rollup'а одного дня. */
export interface BitrixDayRollup {
  daySummary: string;
  rollingSummary: string;
}

/** Минимальная форма сообщения для рендера транскрипта. */
export interface BitrixTranscriptMessage {
  authorName?: string | null;
  text?: string | null;
}

/**
 * Чистый рендер транскрипта сессии в строку (для payload). Формат на строку:
 * `<имя автора>: <текст>`. Пустой/отсутствующий текст → `[вложение/системное]`.
 */
export function renderBitrixTranscript(
  msgs: BitrixTranscriptMessage[],
): string {
  return msgs
    .map((m) => {
      const name = m.authorName?.trim() || 'Сотрудник';
      const body = m.text && m.text.trim() !== '' ? m.text : '[вложение/системное]';
      return `${name}: ${body}`;
    })
    .join('\n');
}

/** Снять markdown-ограждение (```json … ```), если модель его добавила. */
function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Безопасный парс JSON-ответа rollup'а; null при любой кривизне. */
export function parseDayRollup(text: string): BitrixDayRollup | null {
  try {
    const obj = JSON.parse(stripCodeFence(text)) as unknown;
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>;
      const { daySummary, rollingSummary } = rec;
      if (typeof daySummary === 'string' && typeof rollingSummary === 'string') {
        return {
          daySummary: daySummary.trim(),
          rollingSummary: rollingSummary.trim(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class BitrixIngestService {
  private readonly logger = new Logger(BitrixIngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /**
   * Lazy upsert `Source(type='bitrix', name='Bitrix24')` для tenant'а.
   * Конкурентно-безопасен (try/catch на P2002 — повторный findUnique).
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
          tenantId_type_name: { tenantId, type: SOURCE_TYPE, name: SOURCE_NAME },
        },
        select: { id: true },
      });
      if (retry) return retry;
      throw err;
    }
  }

  /**
   * Карта `authorExternalId → { name, personId }` для авторов сессии: имя берём
   * из `BitrixUser` (на сообщении оно не хранится), `personId` — из связки
   * `BitrixUser.linkedPersonId` (strong-ID для атрибуции subject в графе).
   */
  private async resolveAuthors(
    tenantId: string,
    authorExternalIds: string[],
  ): Promise<Map<string, { name: string | null; personId: string | null }>> {
    const map = new Map<string, { name: string | null; personId: string | null }>();
    const ids = [...new Set(authorExternalIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return map;
    const users = await this.prisma.bitrixUser.findMany({
      where: { tenantId, externalId: { in: ids } },
      select: { externalId: true, name: true, linkedPersonId: true },
    });
    for (const u of users) {
      map.set(u.externalId, { name: u.name, personId: u.linkedPersonId });
    }
    return map;
  }

  /**
   * Посуточный rollup закрытой сессии-суток: ОДИН LLM-вызов
   * (`накопительное + сообщения дня → { daySummary, rollingSummary }`).
   * Персистит `BitrixDialogSession.summary` (день) и `BitrixDialog.rollingSummary`
   * (+ `rollingSummaryAt`, накопительное). Best-effort — при любой ошибке LLM
   * (или пустой сессии) возвращает null и НЕ роняет мост в knowledge-core.
   */
  async generateDayRollup(
    tenantId: string,
    sessionId: string,
  ): Promise<BitrixDayRollup | null> {
    const session = await this.prisma.bitrixDialogSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true, dialogId: true },
    });
    if (!session) return null;

    const dialog = await this.prisma.bitrixDialog.findFirst({
      where: { id: session.dialogId, tenantId },
      select: { id: true, rollingSummary: true },
    });

    const messages = await this.prisma.bitrixMessage.findMany({
      where: { tenantId, sessionId },
      orderBy: { externalCreatedAt: 'asc' },
      select: { authorExternalId: true, text: true },
    });
    if (messages.length === 0) return null;

    const authorMap = await this.resolveAuthors(
      tenantId,
      messages.map((m) => m.authorExternalId ?? ''),
    );
    const transcript = renderBitrixTranscript(
      messages.map((m) => ({
        authorName: m.authorExternalId
          ? (authorMap.get(m.authorExternalId)?.name ?? null)
          : null,
        text: m.text,
      })),
    );

    const prevRolling = dialog?.rollingSummary?.trim() || '(пусто)';
    const variableInput = [
      'НАКОПИТЕЛЬНОЕ САММАРИ (прошлые дни):',
      prevRolling,
      '',
      'СООБЩЕНИЯ ЗА ДЕНЬ:',
      transcript,
    ].join('\n');

    // Анти-инъекция: текст переписки — внешний пользовательский ввод.
    const { system, user } = applyInputGuards(
      DAY_ROLLUP_SYSTEM_PROMPT,
      variableInput,
      { injection: true },
    );

    let parsed: BitrixDayRollup | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        const result = await this.llm.call({
          // Переиспользуем seed-route 'chatbox-summary' (sensitive → anthropic):
          // та же природа задачи (саммари чат-переписки), не плодим новый route,
          // иначе новый sensitive-taskType без seed уехал бы по fallback-цепочке.
          taskType: 'chatbox-summary',
          systemPrompt: system,
          userMessage: user,
          tenantId,
          dataClass: 'sensitive',
          maxTokens: 900,
          sourceRef: { type: 'bitrix_dialog_session', id: sessionId },
          // Кривой JSON → router уйдёт на следующего провайдера (двойная страховка).
          validate: (t: string) => parseDayRollup(t) !== null,
        });
        parsed = parseDayRollup(result.text);
      } catch (err) {
        this.logger.warn(
          `generateDayRollup: LLM-ошибка session=${sessionId} tenant=${tenantId} attempt=${attempt}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        break;
      }
    }
    if (!parsed) return null;

    // Персист: день — на сессию, накопительное — на диалог.
    await this.prisma.bitrixDialogSession.updateMany({
      where: { id: sessionId, tenantId },
      data: { summary: parsed.daySummary },
    });
    if (dialog) {
      await this.prisma.bitrixDialog.updateMany({
        where: { id: dialog.id, tenantId },
        data: {
          rollingSummary: parsed.rollingSummary,
          rollingSummaryAt: new Date(),
        },
      });
    }
    return parsed;
  }

  /**
   * Превращает закрытую сессию-сутки в `RawEvent(sourceType='bitrix')` через
   * `IngestService.ingest` (мост в knowledge-core). Анализируем только закрытые
   * сессии (`endedAt != null`).
   *
   * Идемпотентно: `sourceExternalId=sessionId` + `occurredAt=startedAt`
   * (стабильный) → idempotencyKey не меняется, повторный вызов не плодит RawEvent.
   *
   * @returns `{ rawEventId }` или null (открытая/отсутствующая сессия).
   */
  async ingestSession(
    tenantId: string,
    sessionId: string,
  ): Promise<{ rawEventId: string } | null> {
    const session = await this.prisma.bitrixDialogSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        id: true,
        dialogId: true,
        seq: true,
        startedAt: true,
        endedAt: true,
        summary: true,
      },
    });
    if (!session || session.endedAt === null) return null;

    const dialog = await this.prisma.bitrixDialog.findFirst({
      where: { id: session.dialogId, tenantId },
      select: {
        externalId: true,
        title: true,
        type: true,
        rollingSummary: true,
      },
    });

    const messages = await this.prisma.bitrixMessage.findMany({
      where: { tenantId, sessionId },
      orderBy: { externalCreatedAt: 'asc' },
      select: { authorExternalId: true, text: true, externalCreatedAt: true },
    });

    const authorMap = await this.resolveAuthors(
      tenantId,
      messages.map((m) => m.authorExternalId ?? ''),
    );

    const renderMsgs: BitrixTranscriptMessage[] = messages.map((m) => ({
      authorName: m.authorExternalId
        ? (authorMap.get(m.authorExternalId)?.name ?? null)
        : null,
      text: m.text,
    }));
    const fullText = renderBitrixTranscript(renderMsgs);

    // Per-message turns: обе стороны — сотрудники, authorPersonId резолвится из
    // BitrixUser.linkedPersonId автора реплики (для subject-атрибуции в графе).
    const transcriptTurns = messages.map((m, i) => {
      const author = m.authorExternalId
        ? authorMap.get(m.authorExternalId)
        : undefined;
      const name = author?.name?.trim() || 'Сотрудник';
      return {
        speaker: name,
        text: m.text ?? '',
        startSec: i,
        endSec: i + 0.9,
        speakerParticipantId: null,
        authorPersonId: author?.personId ?? null,
      };
    });

    const payload = {
      kind: 'bitrix_dialog_session' as const,
      dialogExternalId: dialog?.externalId ?? null,
      dialogTitle: dialog?.title ?? null,
      dialogType: dialog?.type ?? null,
      sessionId: session.id,
      sessionSeq: session.seq,
      // Посуточное + накопительное (для подмешивания в downstream-анализ).
      daySummary: session.summary ?? null,
      rollingSummary: dialog?.rollingSummary ?? null,
      messages: messages.map((m) => ({
        at: m.externalCreatedAt.toISOString(),
        from: m.authorExternalId
          ? (authorMap.get(m.authorExternalId)?.name ?? null)
          : null,
        authorExternalId: m.authorExternalId ?? null,
        text: m.text ?? null,
      })),
      // Обязателен для block-ingest worker (generic-путь ищет fullText).
      fullText,
      // Per-message turns: buildSegments идёт по meeting-пути (сегмент на сообщение).
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);
    const occurredAt = session.startedAt; // стабильный → idempotencyKey не плывёт

    const res = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: sessionId,
      occurredAt,
      payload,
      dataClass: 'sensitive',
    });

    await this.prisma.bitrixDialogSession.updateMany({
      where: { id: session.id, tenantId },
      data: { rawEventId: res.rawEvent.id },
    });

    return { rawEventId: res.rawEvent.id };
  }

  // ─────────────────────────── CRM посуточный дайджест (Ф4b) ─────────

  /**
   * Посуточные дайджесты изменений CRM (контакты/компании/сделки/лиды) →
   * по одному `RawEvent(sourceType=bitrix, sourceExternalId='crm-digest-<день>')`
   * на закрытый день с изменениями. «Закрываем день»: дайджестим только дни
   * строго в прошлом (UTC), от курсора `lastCrmDigestAt` (или за последние
   * `CRM_BACKFILL_DAYS` дней на старте) до вчера включительно, не более
   * `MAX_DIGEST_DAYS_PER_RUN` за проход. Курсор двигаем даже по пустым дням.
   *
   * Дайджест НЕ делает отдельного LLM-вызова: `fullText` детерминированный, а
   * извлечение знаний делает downstream block-ingest (экономим LLM). Гейт
   * `analysisEnabled` — на стороне вызывающего крона.
   */
  async ingestCrmDigests(tenantId: string): Promise<{ daysDigested: number }> {
    const integ = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId },
      select: { lastCrmDigestAt: true },
    });
    if (!integ) return { daysDigested: 0 };

    const today0 = startOfUtcDay(new Date());
    let dayStart = integ.lastCrmDigestAt
      ? startOfUtcDay(integ.lastCrmDigestAt)
      : new Date(today0.getTime() - CRM_BACKFILL_DAYS * DAY_MS);
    if (dayStart >= today0) return { daysDigested: 0 };

    let processed = 0;
    let boundary = dayStart;
    while (dayStart < today0 && processed < MAX_DIGEST_DAYS_PER_RUN) {
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      await this.buildCrmDigestForDay(tenantId, dayStart, dayEnd);
      boundary = dayEnd;
      processed += 1;
      dayStart = dayEnd;
    }

    await this.prisma.bitrixIntegration.updateMany({
      where: { tenantId },
      data: { lastCrmDigestAt: boundary },
    });
    return { daysDigested: processed };
  }

  /**
   * Один день: собрать изменённые CRM-сущности (по `modifiedAt`), отрендерить
   * детерминированный `fullText` и заингестить `RawEvent`. Пустой день → no-op
   * (RawEvent не создаётся). Идемпотентно (sourceExternalId+occurredAt стабильны).
   */
  private async buildCrmDigestForDay(
    tenantId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<void> {
    const where = { tenantId, modifiedAt: { gte: dayStart, lt: dayEnd } };
    const [contacts, companies, deals, leads] = await Promise.all([
      this.prisma.bitrixContact.findMany({
        where,
        take: 200,
        select: { name: true, email: true },
      }),
      this.prisma.bitrixCompany.findMany({
        where,
        take: 200,
        select: { title: true },
      }),
      this.prisma.bitrixDeal.findMany({
        where,
        take: 200,
        select: { title: true, stageId: true },
      }),
      this.prisma.bitrixLead.findMany({
        where,
        take: 200,
        select: { title: true, name: true, statusId: true },
      }),
    ]);

    const total =
      contacts.length + companies.length + deals.length + leads.length;
    if (total === 0) return;

    const dayKey = dayStart.toISOString().slice(0, 10);
    const fullText =
      `CRM-изменения за ${dayKey} (Bitrix24).\n\n` +
      digestSection(
        'Контакты',
        contacts.map(
          (c) => `${c.name ?? '—'}${c.email ? ` <${c.email}>` : ''}`,
        ),
      ) +
      digestSection(
        'Компании',
        companies.map((c) => c.title ?? '—'),
      ) +
      digestSection(
        'Сделки',
        deals.map(
          (d) => `${d.title ?? '—'}${d.stageId ? ` — стадия ${d.stageId}` : ''}`,
        ),
      ) +
      digestSection(
        'Лиды',
        leads.map(
          (l) =>
            `${l.title ?? l.name ?? '—'}${l.statusId ? ` — статус ${l.statusId}` : ''}`,
        ),
      );

    const payload = {
      kind: 'bitrix_crm_digest' as const,
      day: dayKey,
      counts: {
        contacts: contacts.length,
        companies: companies.length,
        deals: deals.length,
        leads: leads.length,
      },
      fullText,
    };

    const source = await this.upsertSource(tenantId);
    await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: `crm-digest-${dayKey}`,
      occurredAt: dayStart, // стабильный → idempotencyKey не плывёт
      payload,
      dataClass: 'sensitive',
    });
  }
}
