import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdeaBlock } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';

/**
 * Максимум блоков, отдаваемых LLM для генерации rollup'а.
 * Берём свежие/уверенные блоки — избыток шумит и удорожает вызов.
 */
const CARD_ROLLUP_V2_MAX_BLOCKS = 50;

/**
 * Сколько эвиденс-цитат показываем рядом с каждым блоком.
 * 1 — самой свежей (по sourceTimestamp). Этого достаточно, чтобы LLM
 * привязал ответ к источнику.
 */
const CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK = 1;

/** Топ-N тем, привязанных к карточке через её блоки. */
const CARD_ROLLUP_V2_TOP_THEMES = 3;

/**
 * Системные промпты по виду карточки. Все возвращают связный текст
 * (без JSON / markdown headers), чтобы фронт мог отрендерить как есть.
 */
const SYSTEM_PROMPTS: Record<string, string> = {
  client: `Ты — аналитик в B2B-команде. Тебе дают подборку IdeaBlock'ов (вопрос ↔ доверенный ответ + теги + цитаты), которые относятся к одному клиенту. Также — топ-темы, под которые подпадают эти блоки.
Твоя задача — суммаризировать активность с этим клиентом за весь известный период: что обсуждали, какие у клиента боли/запросы, какие приняты решения, какие риски/договорённости.
Пиши на русском, в форме связного текста (3-6 коротких абзацев), без markdown-заголовков и буллетов. Не выдумывай факты вне предоставленных блоков.`,
  deal: `Ты — RevOps-аналитик. Тебе дают IdeaBlock'и по конкретной сделке (вопрос ↔ доверенный ответ + теги + цитаты) и топ-темы.
Опиши текущий статус сделки: на какой стадии она, какие возражения сняты, какие открыты, какие следующие шаги обещаны и какие риски проявились.
На русском, связным текстом (3-5 абзацев), без markdown-заголовков. Только факты из блоков.`,
  project: `Ты — PM-аналитик. Тебе дают IdeaBlock'и по конкретному проекту и топ-темы.
Опиши прогресс проекта: что сделано, что запланировано, какие принятые решения, риски, командные зависимости. На русском, связным текстом (3-5 абзацев), без markdown.`,
  topic: `Ты — knowledge-инженер. Тебе дают IdeaBlock'и, относящиеся к одной теме / области знаний, и связанные топ-темы.
Сделай краткий обзор «что компания знает по этой теме» — основные факты, открытые вопросы, противоречия, ключевые сущности. На русском, связным текстом (3-5 абзацев), без markdown.`,
  custom: `Ты — аналитик. Тебе дают IdeaBlock'и (вопрос ↔ доверенный ответ + теги + цитаты), сгруппированные пользователем под произвольный кейс, и топ-темы.
Сделай связный обзор: о чём этот кейс, какие основные факты и решения, какие открытые вопросы. На русском, 3-5 абзацев, без markdown.`,
};

interface BlockForRollup
  extends Pick<
    IdeaBlock,
    | 'id'
    | 'name'
    | 'criticalQuestion'
    | 'trustedAnswer'
    | 'tags'
    | 'signalType'
    | 'dataClass'
    | 'createdAt'
  > {
  evidenceQuote?: string | null;
}

export interface CardRollupV2Result {
  /** Сгенерированный summary; null, если генерировать не из чего. */
  summary: string | null;
  /** id топ-тем (до CARD_ROLLUP_V2_TOP_THEMES). */
  topThemeIds: string[];
  /** Сколько блоков было использовано для контекста. */
  blocksUsed: number;
}

/**
 * CardRollupV2Service — генерация `Card.summaryCache` поверх IdeaBlock'ов.
 *
 * Источники блоков для карточки:
 *   1. Через meetings: блоки с Evidence, у которых RawEvent.sourceExternalId
 *      совпадает с id одной из встреч карточки.
 *   2. Через сущности: IdeaBlockEntity.entityId IN (Card.entityId ∪ Card.relatedEntityIds).
 * Объединение, dedup по id, фильтр status='canonical', limit 50 (по `updatedAt DESC`).
 *
 * Топ-темы — `Theme` через `ThemeIdeaBlock`, отсортированные по числу
 * принадлежащих блоков из набора карточки (внутри Org).
 */
@Injectable()
export class CardRollupV2Service {
  private readonly logger = new Logger(CardRollupV2Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async buildRollup(args: {
    tenantId: string;
    cardId: string;
  }): Promise<CardRollupV2Result> {
    const card = await this.prisma.card.findUnique({
      where: { id: args.cardId },
      select: {
        id: true,
        kind: true,
        name: true,
        contactName: true,
        contactEmail: true,
        ownerId: true,
        tenantId: true,
        entityId: true,
        relatedEntityIds: true,
        deletedAt: true,
      },
    });
    if (!card || card.deletedAt) {
      return { summary: null, topThemeIds: [], blocksUsed: 0 };
    }
    if (card.tenantId !== args.tenantId) {
      this.logger.warn(
        { cardId: card.id, tenantId: args.tenantId },
        'card-rollup-v2: tenant mismatch — пропускаем',
      );
      return { summary: null, topThemeIds: [], blocksUsed: 0 };
    }

    // Все встречи карточки (id), чтобы найти связанные блоки через RawEvent.
    const meetingIds = (
      await this.prisma.meeting.findMany({
        where: { cardId: card.id, deletedAt: null },
        select: { id: true },
      })
    ).map((m) => m.id);

    const candidateEntityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];

    const blockIdSet = new Set<string>();

    if (meetingIds.length > 0) {
      // RawEvent → IdeaBlockEvidence → IdeaBlock.
      const meetingBlockRows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEvent: {
            tenantId: args.tenantId,
            sourceExternalId: { in: meetingIds },
          },
          block: { status: 'canonical', tenantId: args.tenantId },
        },
        select: { blockId: true },
        take: CARD_ROLLUP_V2_MAX_BLOCKS * 4,
      });
      for (const r of meetingBlockRows) blockIdSet.add(r.blockId);
    }

    if (candidateEntityIds.length > 0) {
      const entityBlockRows = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: candidateEntityIds },
          block: { status: 'canonical', tenantId: args.tenantId },
        },
        select: { blockId: true },
        take: CARD_ROLLUP_V2_MAX_BLOCKS * 4,
      });
      for (const r of entityBlockRows) blockIdSet.add(r.blockId);
    }

    if (blockIdSet.size === 0) {
      // Нечего суммаризировать — очищаем кэш.
      return { summary: null, topThemeIds: [], blocksUsed: 0 };
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: [...blockIdSet] },
        status: 'canonical',
        tenantId: args.tenantId,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: CARD_ROLLUP_V2_MAX_BLOCKS,
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        trustedAnswer: true,
        tags: true,
        signalType: true,
        dataClass: true,
        createdAt: true,
      },
    });
    if (blocks.length === 0) {
      return { summary: null, topThemeIds: [], blocksUsed: 0 };
    }

    // Свежая цитата на блок (для контекста LLM).
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blocks.map((b) => b.id) } },
      orderBy: [{ sourceTimestamp: 'desc' }, { createdAt: 'desc' }],
      select: { blockId: true, quote: true },
    });
    const quoteByBlock = new Map<string, string>();
    for (const ev of evidenceRows) {
      if (!quoteByBlock.has(ev.blockId)) {
        quoteByBlock.set(ev.blockId, ev.quote);
      }
      if (quoteByBlock.size >= blocks.length * CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK) break;
    }
    const enriched: BlockForRollup[] = blocks.map((b) => ({
      ...b,
      evidenceQuote: quoteByBlock.get(b.id) ?? null,
    }));

    // Топ-темы среди этих блоков.
    const themeRows = await this.prisma.themeIdeaBlock.findMany({
      where: { blockId: { in: blocks.map((b) => b.id) } },
      select: { themeId: true },
    });
    const themeCount = new Map<string, number>();
    for (const r of themeRows) {
      themeCount.set(r.themeId, (themeCount.get(r.themeId) ?? 0) + 1);
    }
    const topThemeIds = [...themeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CARD_ROLLUP_V2_TOP_THEMES)
      .map(([id]) => id);

    const topThemes =
      topThemeIds.length > 0
        ? await this.prisma.theme.findMany({
            where: { id: { in: topThemeIds }, status: 'active', tenantId: args.tenantId },
            select: { id: true, name: true, description: true, branch: true },
          })
        : [];

    // LLM-вызов.
    const systemPrompt = SYSTEM_PROMPTS[card.kind] ?? SYSTEM_PROMPTS.custom!;
    const userMessage = this.buildUserMessage({
      cardKind: card.kind,
      cardName: card.name,
      contactName: card.contactName,
      contactEmail: card.contactEmail,
      blocks: enriched,
      themes: topThemes,
    });
    const result = await this.llm.call({
      taskType: 'card-rollup-v2',
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      userId: card.ownerId,
      sourceRef: { type: 'card', id: card.id },
      // Фаза 11: max dataClass по блокам карточки.
      dataClass: maxDataClass(enriched.map((b) => b.dataClass)),
    });

    const summary = result.text.trim() || null;
    return {
      summary,
      topThemeIds,
      blocksUsed: enriched.length,
    };
  }

  private buildUserMessage(args: {
    cardKind: string;
    cardName: string;
    contactName: string | null;
    contactEmail: string | null;
    blocks: BlockForRollup[];
    themes: Array<{ id: string; name: string; description: string; branch: string | null }>;
  }): string {
    const { cardKind, cardName, contactName, contactEmail, blocks, themes } = args;
    const header = [
      `Карточка: ${cardName}`,
      `Тип: ${cardKind}`,
      contactName ? `Контакт: ${contactName}` : null,
      contactEmail ? `Email: ${contactEmail}` : null,
    ]
      .filter((x): x is string => Boolean(x))
      .join('\n');

    const themesPart =
      themes.length > 0
        ? `\n\nТоп-темы (по числу блоков):\n${themes
            .map(
              (t, i) =>
                `${i + 1}. ${t.name}${t.branch ? ` [ветка: ${t.branch}]` : ''} — ${t.description}`,
            )
            .join('\n')}`
        : '';

    const blocksPart = blocks
      .map((b, i) => {
        const lines: string[] = [
          `Блок ${i + 1}: ${b.name} (signal: ${b.signalType})`,
          `Вопрос: ${b.criticalQuestion}`,
          `Ответ: ${b.trustedAnswer}`,
        ];
        if (b.tags.length > 0) lines.push(`Теги: ${b.tags.join(', ')}`);
        if (b.evidenceQuote) lines.push(`Цитата: «${b.evidenceQuote}»`);
        return lines.join('\n');
      })
      .join('\n\n');

    return `${header}${themesPart}\n\nБлоки (всего ${blocks.length}):\n\n${blocksPart}`;
  }
}
