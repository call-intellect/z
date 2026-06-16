import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { IngestService } from '../ingest/ingest.service';

import { CRM_BACKFILL_DAYS } from './bitrix-sync.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DIGEST_DAYS_PER_RUN = CRM_BACKFILL_DAYS;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function digestSection(label: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return `${label} (${lines.length}):\n${lines.map((x) => `- ${x}`).join('\n')}\n\n`;
}

const SOURCE_TYPE = 'bitrix' as const;
const SOURCE_NAME = 'Bitrix24' as const;

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

export interface BitrixDayRollup {
  daySummary: string;
  rollingSummary: string;
}

export interface BitrixTranscriptMessage {
  authorName?: string | null;
  text?: string | null;
}

export function renderBitrixTranscript(msgs: BitrixTranscriptMessage[]): string {
  return msgs
    .map((m) => {
      const name = m.authorName?.trim() || 'Сотрудник';
      const body = m.text && m.text.trim() !== '' ? m.text : '[вложение/системное]';
      return `${name}: ${body}`;
    })
    .join('\n');
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

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

  async generateDayRollup(tenantId: string, sessionId: string): Promise<BitrixDayRollup | null> {
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
        authorName: m.authorExternalId ? (authorMap.get(m.authorExternalId)?.name ?? null) : null,
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

    const { system, user } = applyInputGuards(DAY_ROLLUP_SYSTEM_PROMPT, variableInput, {
      injection: true,
    });

    let parsed: BitrixDayRollup | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        const result = await this.llm.call({
          taskType: 'chatbox-summary',
          systemPrompt: system,
          userMessage: user,
          tenantId,
          dataClass: 'sensitive',
          maxTokens: 900,
          sourceRef: { type: 'bitrix_dialog_session', id: sessionId },
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

  async ingestSession(tenantId: string, sessionId: string): Promise<{ rawEventId: string } | null> {
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
      authorName: m.authorExternalId ? (authorMap.get(m.authorExternalId)?.name ?? null) : null,
      text: m.text,
    }));
    const fullText = renderBitrixTranscript(renderMsgs);

    const transcriptTurns = messages.map((m, i) => {
      const author = m.authorExternalId ? authorMap.get(m.authorExternalId) : undefined;
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
      daySummary: session.summary ?? null,
      rollingSummary: dialog?.rollingSummary ?? null,
      messages: messages.map((m) => ({
        at: m.externalCreatedAt.toISOString(),
        from: m.authorExternalId ? (authorMap.get(m.authorExternalId)?.name ?? null) : null,
        authorExternalId: m.authorExternalId ?? null,
        text: m.text ?? null,
      })),
      fullText,
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);
    const occurredAt = session.startedAt;

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

    const total = contacts.length + companies.length + deals.length + leads.length;
    if (total === 0) return;

    const dayKey = dayStart.toISOString().slice(0, 10);
    const fullText =
      `CRM-изменения за ${dayKey} (Bitrix24).\n\n` +
      digestSection(
        'Контакты',
        contacts.map((c) => `${c.name ?? '—'}${c.email ? ` <${c.email}>` : ''}`),
      ) +
      digestSection(
        'Компании',
        companies.map((c) => c.title ?? '—'),
      ) +
      digestSection(
        'Сделки',
        deals.map((d) => `${d.title ?? '—'}${d.stageId ? ` — стадия ${d.stageId}` : ''}`),
      ) +
      digestSection(
        'Лиды',
        leads.map(
          (l) => `${l.title ?? l.name ?? '—'}${l.statusId ? ` — статус ${l.statusId}` : ''}`,
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
      occurredAt: dayStart,
      payload,
      dataClass: 'sensitive',
    });
  }
}
