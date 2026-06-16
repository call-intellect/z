import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { getCardRollupV2SystemPrompt } from '../prompts/card-rollup-v2.prompts';
import {
  cardKindLabelRu,
  signalTypeLabel,
} from '../prompts/signal-type-label';

import { DataClassPolicyService } from './dataclass-policy.service';
import { Specialist34ProbeService } from './specialist-3-4-probe.service';

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
 * Дефолтный confidence для rollup'а: текущие промпты возвращают свободный
 * текст без structured output, поэтому модель не отдаёт confidence явно.
 * 0.9 = выше autoThreshold (0.85) → по дефолту auto-canonical.
 *
 * TODO(structured-output): когда промпты card-rollup-v2 переведут на JSON
 * Schema с полем confidence (фаза SPO), брать значение от модели. Сейчас
 * статический дефолт оправдан — rollup-промпты целенаправленно возвращают
 * связный prose, не JSON.
 */
const CARD_ROLLUP_V2_DEFAULT_CONFIDENCE = 0.9;

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

/**
 * SBA α-6 — результат `buildRollup`.
 *
 * Совместим с воркером Фазы 4 (поля `summary` / `topThemeIds` / `blocksUsed`)
 * + расширения под §5 контракта:
 *   - `triageDecision` — что решил curation triage (`auto` / `light` / `deep`).
 *     На `auto` карточка уже обновлена (см. `applied`).
 *   - `applied` — флаг «карточка обновлена прямо сейчас». Для `light`/`deep` —
 *     false, карточка остаётся в текущем состоянии до approve.
 *   - `cardVersionId` — id созданной CardVersion (только для `auto`).
 *   - `curationItemId` — id созданного CurationItem (только для `light`/`deep`).
 *   - `conflictReported` — был ли создан ConflictItem (status contradiction).
 *   - `sourceBlockIds` — итоговый список блоков для citations chat-v2.
 *   - `personSubjectIds` — Person'ы, которым присваиваем карточку как subject.
 *   - `confidence` — итоговая уверенность rollup'а.
 *   - `usedTier` / `usedModel` — какой провайдер реально отработал
 *     (для метрик `core_specialist_llm_tokens_total`).
 */
export interface CardRollupV2Result {
  /** Сгенерированный summary; null, если генерировать не из чего. */
  summary: string | null;
  /** id топ-тем (до CARD_ROLLUP_V2_TOP_THEMES). */
  topThemeIds: string[];
  /** Сколько блоков было использовано для контекста. */
  blocksUsed: number;
  /** SBA α-6: id блоков-источников (для citations). */
  sourceBlockIds: string[];
  /** SBA α-6: Person.id, кому карточка присваивается как subject. */
  personSubjectIds: string[];
  /** SBA α-6: уверенность rollup'а [0..1]. */
  confidence: number;
  /** SBA α-6: решение triage. A1 — 'provisional' (AI-судья) для критических типов. */
  triageDecision: 'auto' | 'provisional' | 'light' | 'deep' | 'skipped';
  /** SBA α-6: была ли карточка фактически обновлена в этом вызове. */
  applied: boolean;
  /** SBA α-6: id созданной CardVersion (если auto). */
  cardVersionId: string | null;
  /** SBA α-6: id созданного CurationItem (если light/deep). */
  curationItemId: string | null;
  /** SBA α-6: создан ли ConflictItem (status contradiction). */
  conflictReported: boolean;
  /** SBA α-6: tier провайдера, который отработал ('primary'/'secondary'/'tertiary'/null). */
  usedTier: string | null;
  /** SBA α-6: модель, которая отработала. */
  usedModel: string | null;
  /** SBA α-6: токены LLM (input + output). */
  llmTokens: { input: number; output: number };
}

/**
 * CardRollupV2Service — генерация `Card.summaryCache` поверх IdeaBlock'ов.
 *
 * SBA α-6 — рефакторинг под §5 контракт зонтичного:
 *   1. Загрузить блоки карточки (через meetings + entities, как было).
 *   2. Top-3 темы через ThemeIdeaBlock.
 *   3. LLM-вызов `card-rollup-v2` с правильным kind-промптом (vendor — новый).
 *   4. Собрать proposedPayload + sourceBlockIds + personSubjectIds.
 *   5. CurationService.triage({ resourceType: 'card', confidence, proposedPayload }).
 *   6. На `auto` — апдейт Card (summary + cachedTopThemeIds + sourceBlockIds +
 *      confidence + currentVersionId + personSubjectIds + lastConfirmedAt).
 *      CardVersion(version=next, changeReason='auto-rollup') создаётся внутри triage.
 *   7. На `light`/`deep` — Card НЕ обновляется до approve. summaryUpdatedAt
 *      обновляется (чтобы дебаунс не штурмовал триаж снова и снова).
 *   8. Conflict detection: regex-эвристика «активный ↔ закрыт» между старым
 *      и новым summary. Если сработала → ConflictService.report(relationType='contradicts').
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
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(Specialist34ProbeService)
    private readonly probes: Specialist34ProbeService,
    // ТЗ 2026-05-24 §4 (F1.2) — @Optional, чтобы старые unit-тесты
    // CardRollupV2Service (без cfg в DI) продолжали работать. При null
    // считаем guard включённым (default-true).
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    // W4.1 — DataClassPolicyService для shadow-compare.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch + @Optional cfg — старые тесты могут не инжектить
   * TypedConfigService. Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async buildRollup(args: {
    tenantId: string;
    cardId: string;
  }): Promise<CardRollupV2Result> {
    const start = Date.now();

    const empty: CardRollupV2Result = {
      summary: null,
      topThemeIds: [],
      blocksUsed: 0,
      sourceBlockIds: [],
      personSubjectIds: [],
      confidence: 0,
      triageDecision: 'skipped',
      applied: false,
      cardVersionId: null,
      curationItemId: null,
      conflictReported: false,
      usedTier: null,
      usedModel: null,
      llmTokens: { input: 0, output: 0 },
    };

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
        summaryCache: true,
      },
    });
    if (!card || card.deletedAt) {
      return empty;
    }
    if (card.tenantId !== args.tenantId) {
      this.logger.warn(
        { cardId: card.id, tenantId: args.tenantId },
        'card-rollup-v2: tenant mismatch — пропускаем',
      );
      return empty;
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
      // Нечего суммаризировать — очищаем кэш и выходим.
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return empty;
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
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return empty;
    }

    const sourceBlockIds = blocks.map((b) => b.id);

    // Свежая цитата на блок (для контекста LLM).
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: sourceBlockIds } },
      orderBy: [{ sourceTimestamp: 'desc' }, { createdAt: 'desc' }],
      select: { blockId: true, quote: true },
    });
    const quoteByBlock = new Map<string, string>();
    for (const ev of evidenceRows) {
      if (!quoteByBlock.has(ev.blockId)) {
        quoteByBlock.set(ev.blockId, ev.quote);
      }
      if (
        quoteByBlock.size >=
        blocks.length * CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK
      )
        break;
    }
    const enriched: BlockForRollup[] = blocks.map((b) => ({
      ...b,
      evidenceQuote: quoteByBlock.get(b.id) ?? null,
    }));

    // Топ-темы среди этих блоков.
    const themeRows = await this.prisma.themeIdeaBlock.findMany({
      where: { blockId: { in: sourceBlockIds } },
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
            where: {
              id: { in: topThemeIds },
              status: 'active',
              tenantId: args.tenantId,
            },
            select: { id: true, name: true, description: true, branch: true },
          })
        : [];

    // SBA α-6 — personSubjectIds: Person'ы с ролью subject в блоках карточки.
    const personSubjectIds = await this.collectPersonSubjects({
      tenantId: args.tenantId,
      blockIds: sourceBlockIds,
    });

    // LLM-вызов.
    const systemPrompt = getCardRollupV2SystemPrompt(card.kind);
    const userMessage = this.buildUserMessage({
      cardKind: card.kind,
      cardName: card.name,
      contactName: card.contactName,
      contactEmail: card.contactEmail,
      blocks: enriched,
      themes: topThemes,
    });
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (блоки карточки + контакт +
    // темы) в маркеры данных + INJECTION_GUARD_NOTE в system.
    // Источник = 'transcript' (user-input = контент блоков встреч).
    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const guardedUser = guardOn ? wrapUserData(userMessage) : userMessage;
    const result = await this.llm.call({
      taskType: 'card-rollup-v2',
      systemPrompt: guardedSystem,
      userMessage: guardedUser,
      tenantId: args.tenantId,
      userId: card.ownerId,
      sourceRef: { type: 'card', id: card.id },
      // Фаза 11: max dataClass по блокам карточки.
      dataClass: maxDataClass(enriched.map((b) => b.dataClass)),
      // ТЗ 2026-05-25 LLM-architecture §10.4 Find 1 — текст summary карточки
      // (несколько абзацев) + резерв на thinking при переключении на Pro.
      maxTokens: 8_000,
    });

    const summary = result.text.trim() || null;
    const confidence = CARD_ROLLUP_V2_DEFAULT_CONFIDENCE;
    const usedTier = result.tier ?? null;
    const usedModel = result.modelUsed ?? null;
    const llmTokens = {
      input: result.inputTokens,
      output: result.outputTokens,
    };

    // Метрика токенов специалиста (см. §5.7 зонтичного).
    if (llmTokens.input + llmTokens.output > 0 && usedModel) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'card',
        model: usedModel,
        tier: usedTier ?? 'primary',
        tokens: llmTokens.input + llmTokens.output,
      });
    }

    if (!summary) {
      // LLM вернула пустой текст — не отправляем в triage (бессмысленно).
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return {
        ...empty,
        topThemeIds,
        blocksUsed: enriched.length,
        sourceBlockIds,
        personSubjectIds,
        confidence,
        usedTier,
        usedModel,
        llmTokens,
        triageDecision: 'skipped',
      };
    }

    // SBA α-6 — triage перед канонизацией.
    const proposedPayload: Record<string, unknown> = {
      summaryCache: summary,
      kind: card.kind,
      name: card.name,
      entityId: card.entityId,
      sourceBlockIds,
      cachedTopThemeIds: topThemeIds,
      personSubjectIds,
      confidence,
    };

    // W4.1/W4.2 — derive DataClass.
    // legacy = 'internal' (hardcoded для card_rollup), proposed — derive из
    // enriched-blocks с floor=internal по kind='card_rollup'.
    // На 'enforce' — triage получает derive().dataClass + сохраняем audit
    // в Card. На shadow/off — legacy.
    const enforcementCr = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const derivedCr = this.dataClassPolicy?.derive({
      sources: enriched.map((b) => ({
        dataClass: b.dataClass,
        sourceId: b.id,
        sourceKind: 'idea_block' as const,
      })),
      context: { kind: 'card_rollup' },
    });
    if (this.dataClassPolicy && derivedCr) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: 'internal',
        proposedResult: derivedCr.dataClass,
        kind: 'card_rollup',
        sourceIds: enriched.map((b) => b.id),
      });
    }
    const effectiveDcCr =
      enforcementCr === 'enforce' && derivedCr
        ? derivedCr.dataClass
        : 'internal';
    const auditCr: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      enforcementCr === 'enforce' && derivedCr
        ? (derivedCr.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const triage = await this.curation.triage({
      tenantId: args.tenantId,
      resourceType: 'card',
      resourceId: card.id,
      confidence,
      proposedPayload,
      conflictSignal: 'none',
      createdByUserId: null,
      dataClass: effectiveDcCr,
    });

    let applied = false;
    const cardVersionId: string | null = triage.cardVersionId;
    const curationItemId: string | null = triage.curationItemId;

    // Б5 [K9] — `provisional` (системно канонизировано AI-судьёй для критических
    // типов, см. triageDecision 'provisional') обновляет Card так же, как 'auto'.
    // Раньше провижн трактовался как «не auto» → Card не обновлялся, а
    // CardVersion создавалась внутри triage → summaryCache/currentVersionId
    // дрейфовали от фактической версии.
    if (triage.decision === 'auto' || triage.decision === 'provisional') {
      const updatedCard = await this.prisma.card.update({
        where: { id: card.id },
        data: {
          summaryCache: summary,
          summaryUpdatedAt: new Date(),
          cachedTopThemeIds: topThemeIds,
          sourceBlockIds,
          confidence: new Prisma.Decimal(confidence),
          currentVersionId: cardVersionId ?? undefined,
          personSubjectIds,
          lastConfirmedAt: new Date(),
          // W4.2 — audit-trail только в enforce-режиме. На shadow/off — JsonNull
          // (поле в БД остаётся null).
          dataClassAudit: auditCr,
        },
      });
      applied = true;

      // SBA α-6 — probe-checks после auto-canonical (см. §5.4 зонтичного).
      // Best-effort: ProbeService сам ловит ошибки, не валит rollup.
      await this.probes.checkAndEmitProbes(updatedCard);
    } else {
      // light/deep — Card НЕ обновляется до approve. Освежаем только метку,
      // чтобы дебаунс не вызывал тот же rollup повторно (60s debounce из
      // CoreQueueService).
      await this.prisma.card.update({
        where: { id: card.id },
        data: { summaryUpdatedAt: new Date() },
      });
    }

    // SBA α-6 — conflict detection: статус контрадикция между старым summary
    // и новым. Если карточка резко поменяла знак («закрыт» → «активен» и
    // наоборот) — это сигнал к ConflictItem(relationType='contradicts').
    // Б6 [K9] — conflict.report только когда новое summary ФАКТИЧЕСКИ применено
    // (applied). На light/deep/provisional-not-applied summaryCache карточки не
    // менялся → сравнивать «старое vs новое» бессмысленно, а ConflictItem ушёл
    // бы ложно (новое summary ещё ждёт approve, противоречия в graph нет).
    let conflictReported = false;
    if (
      applied &&
      summary &&
      card.summaryCache &&
      this.detectStatusContradiction(card.summaryCache, summary)
    ) {
      try {
        await this.conflicts.report({
          tenantId: args.tenantId,
          resourceType: 'card',
          // Сам с собой — две версии одной карточки. existingId vs newId
          // должны различаться, поэтому помечаем «previous-version» через
          // отдельный resource. Пока хранилища previousId у Card нет — берём
          // currentVersionId, если есть; иначе пропускаем conflict.report.
          existingId: card.id,
          newId: `${card.id}:next`,
          relationType: 'contradicts',
          detectedBy: 'specialist',
          evidence: {
            specialistName: '3-4-project-customer',
            heuristic: 'status-keyword-flip',
            oldSummary: card.summaryCache.slice(0, 1_000),
            newSummary: summary.slice(0, 1_000),
            sourceBlockIds: sourceBlockIds.slice(0, 20),
          },
        });
        conflictReported = true;
        this.metrics.incCoreSpecialistConflictEvent({ type: 'card' });
      } catch (err) {
        // ConflictService.report валидирует existingId !== newId. Если
        // сработает другая ошибка — лог и продолжаем (best-effort, не валим
        // rollup).
        this.logger.warn(
          {
            cardId: card.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'card-rollup-v2: conflict.report не удался — пропускаю',
        );
      }
    }

    this.metrics.observeCoreSpecialistPipelineDuration({
      type: 'card',
      seconds: (Date.now() - start) / 1000,
    });

    return {
      summary,
      topThemeIds,
      blocksUsed: enriched.length,
      sourceBlockIds,
      personSubjectIds,
      confidence,
      triageDecision: triage.decision,
      applied,
      cardVersionId,
      curationItemId,
      conflictReported,
      usedTier,
      usedModel,
      llmTokens,
    };
  }

  /**
   * SBA α-6 — соберём Person.id, для которых хотя бы один блок-источник
   * упоминает их как `IdeaBlockEntity.role='subject'`. Используется
   * Skill-агентом (γ-1) для атрибуции «знание присвоено сотруднику X».
   */
  private async collectPersonSubjects(args: {
    tenantId: string;
    blockIds: string[];
  }): Promise<string[]> {
    if (args.blockIds.length === 0) return [];
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId: { in: args.blockIds },
        role: 'subject',
        entity: { type: 'person' },
      },
      select: { entityId: true },
    });
    if (rows.length === 0) return [];
    const entityIds = [...new Set(rows.map((r) => r.entityId))];
    const persons = await this.prisma.person.findMany({
      where: {
        entityId: { in: entityIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    return persons.map((p) => p.id);
  }

  /**
   * Простая эвристика: содержит ли старый summary «закрыт/завершён» и
   * новый — «активен/идёт» (или наоборот). Это сигнал, что специалист
   * увидел противоречивые блоки. LLM-арбитр конфликтов появится в β-.
   */
  private detectStatusContradiction(oldText: string, newText: string): boolean {
    const closedRe = /\b(закрыт|закрыто|завершён|завершен|остановлен|приостановлен|отменён|отменен)\b/i;
    const activeRe = /\b(активен|активна|активно|идёт|идет|развивается|продолжается|открыт|открыта)\b/i;
    const oldClosed = closedRe.test(oldText);
    const oldActive = activeRe.test(oldText);
    const newClosed = closedRe.test(newText);
    const newActive = activeRe.test(newText);
    return (oldClosed && newActive) || (oldActive && newClosed);
  }

  private buildUserMessage(args: {
    cardKind: string;
    cardName: string;
    contactName: string | null;
    contactEmail: string | null;
    blocks: BlockForRollup[];
    themes: Array<{
      id: string;
      name: string;
      description: string;
      branch: string | null;
    }>;
  }): string {
    const { cardKind, cardName, contactName, contactEmail, blocks, themes } =
      args;
    // ТЗ 2026-06-16 (пачка 7, E3): вид карточки и тип сигнала — человеческими
    // ярлыками; машинная ветка темы (branch) в USER-строку не выводится.
    const header = [
      `Карточка: ${cardName}`,
      `Тип: ${cardKindLabelRu(cardKind)}`,
      contactName ? `Контакт: ${contactName}` : null,
      contactEmail ? `Email: ${contactEmail}` : null,
    ]
      .filter((x): x is string => Boolean(x))
      .join('\n');

    const themesPart =
      themes.length > 0
        ? `\n\nТоп-темы (по числу блоков):\n${themes
            .map((t, i) => `${i + 1}. ${t.name} — ${t.description}`)
            .join('\n')}`
        : '';

    const blocksPart = blocks
      .map((b, i) => {
        const lines: string[] = [
          `Блок ${i + 1}: ${b.name} (тип сигнала: ${signalTypeLabel(b.signalType)})`,
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
