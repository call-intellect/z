import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type CurationDecisionType,
  type CurationItem,
  type CurationLevel,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { SkillTraitCategoryService } from '../../skills/services/skill-trait-categories.service';
import type {
  CurationDecisionDto,
  CurationDecisionTypeDto,
  CurationItemDetailDto,
  CurationItemDto,
  CurationLevelDto,
  CurationSettingsDto,
  ListCurationQueueQuery,
  ListCurationQueueResponse,
  UpdateCurationSettingsBody,
} from '../dto/curation.dto';

import { CuratorRoutingService } from './curator-routing.service';


/** Входной payload для `CurationService.triage`. Вызывается специалистами Слоя 3. */
export interface TriageInput {
  tenantId: string;
  resourceType: string;
  resourceId: string;
  /** confidence карточки [0..1] (raw, сырое значение LLM). */
  confidence: number;
  /**
   * W2.2 KC-Temporal (2026-05-25) — калиброванная confidence через Platt
   * scaling. Если задана — `triage()` использует её для сравнения с порогами
   * (autoThreshold / deepReviewThreshold). Иначе — fallback на `confidence`.
   *
   * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.2.
   */
  calibratedConfidence?: number;
  /** Финальный payload карточки (что специалист предлагает канонизировать). */
  proposedPayload: Record<string, unknown>;
  /** Опц. сигналы конфликта от специалиста: «soft» / «hard». */
  conflictSignal?: 'none' | 'soft' | 'hard';
  /** Опц. дополнительные ID конфликтов, уже созданных через ConflictService. */
  conflictIds?: string[];
  /** Опц. дополнительный criteria (например, `{ tag: 'enterprise' }`). */
  criteria?: Record<string, unknown>;
  /** Опц. явный userId автора (для CardVersion.createdByUserId). */
  createdByUserId?: string | null;
  /** Опц. dataClass карточки (для нотификаций). */
  dataClass?: 'public' | 'internal' | 'sensitive' | 'private';
}

export type TriageDecision = 'auto' | 'light' | 'deep';

export interface TriageResult {
  decision: TriageDecision;
  /** Если 'auto' — id созданного CardVersion. Иначе — null. */
  cardVersionId: string | null;
  /** Если 'light' | 'deep' — id созданного CurationItem. Иначе — null. */
  curationItemId: string | null;
  /** Кандидаты-кураторы (после dispatch'а). */
  candidateCuratorIds: string[];
}

export interface DecideInput {
  tenantId: string;
  curationItemId: string;
  reviewerUserId: string;
  decisionType: CurationDecisionTypeDto;
  payload?: Record<string, unknown>;
  reasoning?: string;
}

/**
 * G.3 KC-Temporal (2026-05-25) — payload для `recordDecision`.
 *
 * Используется, когда нужно зафиксировать post-hoc решение по карточке/ребру
 * (например, «это неверно» из UI Карты знаний) БЕЗ существующего CurationItem.
 *
 * Сервис создаёт CurationItem в статусе `decided` (level='light',
 * proposedPayload=пусто) и приписывает к нему CurationDecision выбранного типа.
 *
 * Эмитится `curation.decision_recorded` → PreferenceDatasetService запишет
 * LlmPreferenceSample (для `mark_as_misleading` → label='misleading').
 */
export interface RecordDecisionInput {
  tenantId: string;
  /// `resourceType` — что помечаем: 'entity', 'entity_link', 'block',
  /// 'idea_block_link', 'skill_trait', 'card', ... Произвольная строка
  /// (см. соглашение специалистов).
  resourceType: string;
  resourceId: string;
  decisionType: CurationDecisionTypeDto;
  recordedBy: string;
  reason?: string | null;
  /// Опц. taskType для LlmPreferenceSample — если не передан, выводится из
  /// `resourceType` через `resourceTypeToTaskType` в PreferenceDatasetService.
  taskType?: string | null;
  /// Опц. дополнительный контекст (попадает в proposedPayload и CardVersion
  /// если decisionType писал бы версию — но для mark_as_misleading не пишет).
  context?: Record<string, unknown>;
}

const DEFAULT_AUTO_THRESHOLD = 0.85;
const DEFAULT_DEEP_REVIEW_THRESHOLD = 0.6;
const DEFAULT_CRITICAL_TYPES = ['regulation', 'process', 'decision'] as const;

/**
 * CurationService — публичный API Слоя 4 (см.
 * plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md §5).
 *
 * Контракт для специалистов Слоя 3:
 *
 *   const res = await curation.triage({
 *     tenantId, resourceType, resourceId,
 *     confidence, proposedPayload, conflictSignal: 'none',
 *   });
 *   if (res.decision === 'auto') {
 *     // карточка канонизирована — версия 1 уже создана в CardVersion;
 *     // специалист обновляет своё хранилище (status='canonical').
 *   } else {
 *     // 'light' | 'deep' — карточка остаётся draft до завершения triage'а.
 *   }
 */
@Injectable()
export class CurationService {
  private readonly logger = new Logger(CurationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(CuratorRoutingService)
    private readonly routing: CuratorRoutingService,
    /**
     * SBA γ-1 доделки — @Optional, потому что CurationModule может
     * импортироваться в worker-процессе ДО регистрации SkillsModule, а
     * `merge_categories` — операция HTTP-only. Если null — endpoint
     * вернёт `merge_categories_unsupported`.
     */
    @Optional()
    @Inject(SkillTraitCategoryService)
    private readonly skillCategories: SkillTraitCategoryService | null,
    /**
     * SBA α-5 dialog-layer — эмит `card-version.created` для cache invalidation.
     * @Optional, чтобы CurationModule можно было поднять без dialog-layer
     * (EventEmitter глобальный, но защищаемся от регрессий).
     */
    @Optional()
    @Inject(EventEmitter2)
    private readonly events: EventEmitter2 | null = null,
  ) {}

  // ──────────────────────────── triage ────────────────────────────

  async triage(input: TriageInput): Promise<TriageResult> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_triage_input',
          message: 'tenantId / resourceType / resourceId обязательны для triage',
        },
      });
    }
    if (input.confidence < 0 || input.confidence > 1) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_confidence',
          message: 'confidence должен быть в диапазоне [0..1]',
        },
      });
    }

    const settings = await this.getSettings(input.tenantId);
    const conflict = input.conflictSignal ?? 'none';
    const isCritical = settings.criticalTypes.includes(input.resourceType);

    // W2.2 KC-Temporal — если калиброванная confidence известна, используем её
    // для сравнения с порогами. Иначе — fallback на raw. См. §W2.2 ТЗ.
    const effectiveConfidence =
      typeof input.calibratedConfidence === 'number' &&
      Number.isFinite(input.calibratedConfidence)
        ? Math.max(0, Math.min(1, input.calibratedConfidence))
        : input.confidence;

    // 1. auto-canonical
    if (
      !isCritical &&
      conflict === 'none' &&
      effectiveConfidence >= settings.autoThreshold
    ) {
      const version = await this.createInitialCardVersion(input);
      this.metrics.incCurationAutoCanonical({ resourceType: input.resourceType });
      this.logger.log(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          versionId: version.id,
        },
        'curation.triage: auto-canonical',
      );
      return {
        decision: 'auto',
        cardVersionId: version.id,
        curationItemId: null,
        candidateCuratorIds: [],
      };
    }

    // 2. deep / light
    let level: CurationLevel;
    if (
      isCritical ||
      conflict === 'hard' ||
      effectiveConfidence < settings.deepReviewThreshold
    ) {
      level = 'deep';
    } else {
      level = 'light';
    }

    const triageReason = {
      confidence: input.confidence,
      // W2.2 — оба значения в reason для прозрачности и debugging'а.
      calibratedConfidence:
        typeof input.calibratedConfidence === 'number'
          ? input.calibratedConfidence
          : null,
      effectiveConfidence,
      conflictSignal: conflict,
      conflictIds: input.conflictIds ?? [],
      criticalType: isCritical,
      autoThreshold: settings.autoThreshold,
      deepReviewThreshold: settings.deepReviewThreshold,
    };

    // ВНИМАНИЕ: dispatchProbe вне транзакции (notifications в БД создаются
    // отдельной транзакцией, побочные эффекты — допустимо best-effort).
    const candidates = await this.routing.resolveCurators({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      level,
      criteria: input.criteria,
    });

    const item = await this.prisma.curationItem.create({
      data: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        level,
        triageReason: triageReason as Prisma.InputJsonValue,
        proposedPayload: input.proposedPayload as Prisma.InputJsonValue,
        candidateCuratorIds: candidates,
        expiresAt: this.expiryDate(settings.itemExpiryDays),
      },
    });

    this.metrics.incCurationItem({
      resourceType: input.resourceType,
      level,
      status: 'pending',
    });

    await this.dispatchProbe({
      item,
      candidateCuratorIds: candidates,
      dataClass: input.dataClass,
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        level,
        candidates: candidates.length,
      },
      'curation.triage: создан CurationItem + dispatch probe',
    );

    return {
      decision: level,
      cardVersionId: null,
      curationItemId: item.id,
      candidateCuratorIds: candidates,
    };
  }

  // ──────────────────────────── decide ────────────────────────────

  async decide(input: DecideInput): Promise<CurationItem> {
    const item = await this.prisma.curationItem.findUnique({
      where: { id: input.curationItemId },
    });
    if (!item || item.tenantId !== input.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'curation_item_not_found',
          message: 'CurationItem не найден',
        },
      });
    }
    if (item.status !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'curation_item_not_pending',
          message: `CurationItem уже в статусе ${item.status}`,
        },
      });
    }

    // Куратор должен быть в candidateCuratorIds, либо owner/admin (выше
    // проверяется RBAC). Если списка кандидатов нет — позволяем любому
    // owner/admin'у.
    if (
      item.candidateCuratorIds.length > 0 &&
      !item.candidateCuratorIds.includes(input.reviewerUserId)
    ) {
      // Дополнительная мягкая проверка через Membership — owner/admin Org
      // имеет право решать вне зависимости от candidateCuratorIds.
      const membership = await this.prisma.membership.findUnique({
        where: {
          orgId_userId: { orgId: input.tenantId, userId: input.reviewerUserId },
        },
        select: { role: true },
      });
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'not_in_candidates',
            message: 'Пользователь не назначен куратором для этой карточки',
          },
        });
      }
    }

    if (input.decisionType === 'reject' && (input.payload ?? null) !== null) {
      // Для reject payload игнорируется.
    }
    if (this.requiresReasoning(input.decisionType, item.level) && !input.reasoning) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'reasoning_required',
          message:
            'reasoning обязателен для deep review и для split/merge/supersede',
        },
      });
    }

    // SBA α-4 wave 2 — валидация payload для merge_categories / escalate.
    if (input.decisionType === 'merge_categories') {
      const src = input.payload?.sourceCategoryId;
      const tgt = input.payload?.targetCategoryId;
      if (typeof src !== 'string' || typeof tgt !== 'string' || src === tgt) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'merge_categories_payload_required',
            message:
              'merge_categories требует payload.sourceCategoryId и payload.targetCategoryId (разные)',
          },
        });
      }
    }
    if (input.decisionType === 'escalate') {
      const next = input.payload?.escalateToUserId;
      if (typeof next !== 'string' || !next) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'escalate_user_required',
            message: 'escalate требует payload.escalateToUserId',
          },
        });
      }
    }

    const now = new Date();
    const isEscalate = input.decisionType === 'escalate';
    let createdDecisionId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const decision = await tx.curationDecision.create({
        data: {
          curationItemId: item.id,
          decisionType: input.decisionType as CurationDecisionType,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          reasoning: input.reasoning ?? null,
          reviewerUserId: input.reviewerUserId,
        },
      });
      createdDecisionId = decision.id;

      // escalate — НЕ финальное решение: item остаётся pending, переназначается
      // следующему куратору через candidateCuratorIds (round-robin).
      if (isEscalate) {
        const nextUserId = String(input.payload?.escalateToUserId);
        const candidates = item.candidateCuratorIds.includes(nextUserId)
          ? item.candidateCuratorIds
          : [...item.candidateCuratorIds, nextUserId];
        const updated = await tx.curationItem.update({
          where: { id: item.id },
          data: {
            // status остаётся pending; assignedToUserId = новый куратор.
            assignedToUserId: nextUserId,
            candidateCuratorIds: candidates,
          },
        });
        return updated;
      }

      const updated = await tx.curationItem.update({
        where: { id: item.id },
        data: {
          status: 'decided',
          decidedAt: now,
          assignedToUserId: input.reviewerUserId,
        },
      });

      // Создаём CardVersion только для approve* / split / merge / supersede.
      // mark_as_misleading / merge_categories — не порождают новую версию исходной
      // карточки (это служебные пометки; merge_categories обрабатывается γ-1
      // специалистом отдельно по сохранённой decision-записи).
      const writesCardVersion =
        input.decisionType === 'approve' ||
        input.decisionType === 'approve_with_edits' ||
        input.decisionType === 'split' ||
        input.decisionType === 'merge' ||
        input.decisionType === 'supersede';
      if (writesCardVersion) {
        const payloadForVersion =
          input.payload && Object.keys(input.payload).length > 0
            ? input.payload
            : (item.proposedPayload as Record<string, unknown>);
        await this.appendCardVersion(tx, {
          tenantId: item.tenantId,
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          payload: payloadForVersion,
          changeReason: input.decisionType,
          createdByUserId: input.reviewerUserId,
          curationDecisionId: decision.id,
          curationItemId: item.id,
        });
      }

      return updated;
    });

    // W2.3 KC-Temporal (2026-05-25) — эмит события для PreferenceDatasetService.
    // Best-effort: ошибка emit не должна валить decide-flow. Слушатель
    // решает, нужно ли записать LlmPreferenceSample (фильтр по decisionType
    // лежит на стороне consumer'а).
    try {
      this.events?.emit('curation.decision_recorded', {
        tenantId: item.tenantId,
        curationItemId: item.id,
        curationDecisionId: createdDecisionId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        decisionType: input.decisionType,
        reviewerUserId: input.reviewerUserId,
        reasoning: input.reasoning ?? null,
        proposedPayload: item.proposedPayload,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.decision_recorded emit failed (handled inside)',
      );
    }

    // Метрики (вне транзакции, best-effort).
    this.metrics.incCurationDecision({
      decisionType: input.decisionType,
      level: item.level,
    });
    if (!isEscalate) {
      this.metrics.incCurationItem({
        resourceType: item.resourceType,
        level: item.level,
        status: 'decided',
      });
      const seconds = Math.max(
        0,
        Math.floor((now.getTime() - item.createdAt.getTime()) / 1000),
      );
      this.metrics.observeCurationTimeToDecide({ level: item.level, seconds });
    }

    this.logger.log(
      {
        tenantId: item.tenantId,
        itemId: item.id,
        decisionType: input.decisionType,
        reviewer: input.reviewerUserId,
        escalated: isEscalate,
      },
      isEscalate
        ? 'curation.decide: escalate — переназначено следующему куратору'
        : 'curation.decide: решение принято',
    );

    // SBA γ-1 доделки — пост-decision эффект для `merge_categories`:
    // вызываем SkillTraitCategoryService.merge ПОСЛЕ commit'а транзакции.
    // Best-effort: ошибка merge'а не откатывает CurationDecision — куратор
    // увидит запись в decision-log и может повторить вручную через REST.
    if (input.decisionType === 'merge_categories' && !isEscalate) {
      const sourceId = String(input.payload?.sourceCategoryId ?? '');
      const targetId = String(input.payload?.targetCategoryId ?? '');
      if (!this.skillCategories) {
        this.logger.warn(
          { itemId: item.id, sourceId, targetId },
          'curation.decide: merge_categories — SkillTraitCategoryService недоступен (worker-процесс?). Решение зафиксировано, merge не выполнен.',
        );
      } else if (sourceId && targetId) {
        try {
          await this.skillCategories.merge({
            tenantId: item.tenantId,
            userId: input.reviewerUserId,
            sourceId,
            targetId,
            reasoning: input.reasoning ?? null,
            via: 'curation_decision',
            curationDecisionId: createdDecisionId,
          });
        } catch (err) {
          this.logger.warn(
            {
              itemId: item.id,
              sourceId,
              targetId,
              err: err instanceof Error ? err.message : String(err),
            },
            'curation.decide: merge_categories handler упал (best-effort)',
          );
        }
      }
    }

    return result;
  }

  // ──────────────────────────── recordDecision ────────────────────
  /**
   * G.3 KC-Temporal (2026-05-25) — post-hoc запись «карточка/ребро неверны»
   * без существующего CurationItem (UI Карты знаний, кнопка «Это неверно»).
   *
   * Создаёт CurationItem(status='decided', level='light') + CurationDecision
   * за одну транзакцию; затем эмитит `curation.decision_recorded` →
   * PreferenceDatasetService запишет LlmPreferenceSample.
   *
   * Возвращает id созданных записей. Best-effort: ошибка emit не валит
   * транзакцию (как в `decide`).
   */
  async recordDecision(
    input: RecordDecisionInput,
  ): Promise<{ curationItemId: string; curationDecisionId: string }> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_record_decision_input',
          message:
            'tenantId / resourceType / resourceId обязательны для recordDecision',
        },
      });
    }
    if (!input.recordedBy) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'recorded_by_required',
          message: 'recordedBy (User.id) обязателен',
        },
      });
    }
    const proposedPayload = (input.context ?? {}) as Prisma.InputJsonValue;
    const triageReason = {
      via: 'recordDecision',
      reason: input.reason ?? null,
      taskType: input.taskType ?? null,
    };

    const now = new Date();
    const { item, decision } = await this.prisma.$transaction(async (tx) => {
      const createdItem = await tx.curationItem.create({
        data: {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          level: 'light',
          status: 'decided',
          assignedToUserId: input.recordedBy,
          triageReason: triageReason as Prisma.InputJsonValue,
          proposedPayload,
          decidedAt: now,
        },
      });
      const createdDecision = await tx.curationDecision.create({
        data: {
          curationItemId: createdItem.id,
          decisionType: input.decisionType as CurationDecisionType,
          payload: proposedPayload,
          reasoning: input.reason ?? null,
          reviewerUserId: input.recordedBy,
        },
      });
      return { item: createdItem, decision: createdDecision };
    });

    try {
      this.events?.emit('curation.decision_recorded', {
        tenantId: item.tenantId,
        curationItemId: item.id,
        curationDecisionId: decision.id,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        decisionType: input.decisionType,
        reviewerUserId: input.recordedBy,
        reasoning: input.reason ?? null,
        proposedPayload: item.proposedPayload,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.recordDecision emit failed (handled inside)',
      );
    }

    this.metrics.incCurationDecision({
      decisionType: input.decisionType,
      level: 'light',
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        decisionId: decision.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        decisionType: input.decisionType,
        recordedBy: input.recordedBy,
      },
      'curation.recordDecision: post-hoc решение зафиксировано',
    );

    return { curationItemId: item.id, curationDecisionId: decision.id };
  }

  // ──────────────────────────── list / get ────────────────────────

  async listQueue(args: {
    tenantId: string;
    requesterUserId: string;
    query: ListCurationQueueQuery;
  }): Promise<ListCurationQueueResponse> {
    const { tenantId, requesterUserId, query } = args;
    const where: Prisma.CurationItemWhereInput = { tenantId };
    if (query.level) where.level = query.level;
    if (query.status) where.status = query.status;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.assignedToMe) {
      where.OR = [
        { assignedToUserId: requesterUserId },
        { candidateCuratorIds: { has: requesterUserId } },
      ];
    }

    if (query.limit === 0) {
      // count-only режим.
      const total = await this.prisma.curationItem.count({ where });
      return { items: [], total, page: 1, limit: 0, totalPages: 0 };
    }

    const [items, total] = await Promise.all([
      this.prisma.curationItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.curationItem.count({ where }),
    ]);
    return {
      items: items.map((i) => this.toItemDto(i)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, query.limit))),
    };
  }

  async getItemById(args: {
    tenantId: string;
    id: string;
  }): Promise<CurationItemDetailDto> {
    const item = await this.prisma.curationItem.findUnique({
      where: { id: args.id },
      include: {
        decisions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!item || item.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'curation_item_not_found',
          message: 'CurationItem не найден',
        },
      });
    }
    // Подмешиваем связанные открытые конфликты для resourceId.
    const conflicts = await this.prisma.conflictItem.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType: item.resourceType,
        status: 'open',
        OR: [{ existingId: item.resourceId }, { newId: item.resourceId }],
      },
      select: { id: true },
    });
    return {
      ...this.toItemDto(item),
      decisions: item.decisions.map((d) => this.toDecisionDto(d)),
      relatedConflictIds: conflicts.map((c) => c.id),
    };
  }

  // ──────────────────────────── settings ──────────────────────────

  async getSettings(tenantId: string): Promise<CurationSettingsDto> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { curationSettings: true },
    });
    return this.normalizeSettings(org?.curationSettings ?? null);
  }

  async updateSettings(args: {
    tenantId: string;
    patch: UpdateCurationSettingsBody;
  }): Promise<CurationSettingsDto> {
    const current = await this.getSettings(args.tenantId);
    const next: CurationSettingsDto = {
      autoThreshold: args.patch.autoThreshold ?? current.autoThreshold,
      deepReviewThreshold:
        args.patch.deepReviewThreshold ?? current.deepReviewThreshold,
      criticalTypes: args.patch.criticalTypes ?? current.criticalTypes,
      itemExpiryDays: args.patch.itemExpiryDays ?? current.itemExpiryDays,
    };
    if (next.autoThreshold < next.deepReviewThreshold) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_thresholds',
          message:
            'autoThreshold должен быть >= deepReviewThreshold (иначе triage не имеет «light» окна)',
        },
      });
    }
    await this.prisma.org.update({
      where: { id: args.tenantId },
      data: { curationSettings: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  // ──────────────────────────── helpers ──────────────────────────

  private requiresReasoning(
    decisionType: CurationDecisionTypeDto,
    level: CurationLevel,
  ): boolean {
    if (level === 'deep') return true;
    return (
      decisionType === 'split' ||
      decisionType === 'merge' ||
      decisionType === 'supersede' ||
      /// SBA α-4 wave 2 — merge_categories / escalate всегда требуют обоснование.
      decisionType === 'merge_categories' ||
      decisionType === 'escalate'
    );
  }

  /**
   * Создаёт первую CardVersion (`version=1`) для auto-canonical.
   */
  private async createInitialCardVersion(input: TriageInput) {
    return this.appendCardVersion(this.prisma, {
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.proposedPayload,
      changeReason: 'initial',
      createdByUserId: input.createdByUserId ?? null,
      curationDecisionId: null,
      curationItemId: null,
    });
  }

  /**
   * Создаёт CardVersion, корректно вычисляя `version` и `previousVersionId`.
   *
   * NB: внутри транзакции — корректный read-then-write. Гарантия unique на
   * `(resourceType, resourceId, version)` защищает от двойной записи (если
   * две триажа одновременно создают v1, второй упадёт с unique-error).
   */
  private async appendCardVersion(
    db: PrismaService | Prisma.TransactionClient,
    args: {
      tenantId: string;
      resourceType: string;
      resourceId: string;
      payload: Record<string, unknown>;
      changeReason: string;
      createdByUserId: string | null;
      curationDecisionId: string | null;
      curationItemId: string | null;
    },
  ) {
    const last = await db.cardVersion.findFirst({
      where: { resourceType: args.resourceType, resourceId: args.resourceId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const created = await db.cardVersion.create({
      data: {
        tenantId: args.tenantId,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        version,
        previousVersionId: last?.id ?? null,
        payload: args.payload as Prisma.InputJsonValue,
        changeReason: args.changeReason,
        createdByUserId: args.createdByUserId,
        curationDecisionId: args.curationDecisionId,
        curationItemId: args.curationItemId,
      },
    });
    // SBA α-5 dialog-layer — эмит для CacheInvalidationService.
    // Best-effort: ошибка emit не должна валить triage.
    try {
      this.events?.emit('card-version.created', {
        tenantId: args.tenantId,
        cardVersionId: created.id,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'card-version.created emit failed (handled inside)',
      );
    }
    return created;
  }

  private expiryDate(days: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  /**
   * Отправка probe-нотификации каждому кандидату-куратору через
   * ConversationalService. Best-effort: ошибка одного канала не валит triage.
   */
  private async dispatchProbe(args: {
    item: CurationItem;
    candidateCuratorIds: string[];
    dataClass?: 'public' | 'internal' | 'sensitive' | 'private';
  }): Promise<void> {
    const { item, candidateCuratorIds } = args;
    const summary = this.buildProbeSummary(item);
    const actionUrl = `/curation/${item.id}`;
    const dataClass = args.dataClass ?? 'internal';

    for (const userId of candidateCuratorIds) {
      try {
        await this.conversational.sendNotification({
          tenantId: item.tenantId,
          recipientUserId: userId,
          eventType: 'curation.pending',
          payload: {
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            summary,
            confidence: this.extractConfidenceFromReason(item.triageReason),
            actionUrl,
          },
          dataClass,
          contextCardId: item.resourceId,
          expiresAt: item.expiresAt ? item.expiresAt.toISOString() : undefined,
        });

        // Для deep review дополнительно отправляем эскалацию через system.message.
        if (item.level === 'deep') {
          await this.conversational.sendNotification({
            tenantId: item.tenantId,
            recipientUserId: userId,
            eventType: 'system.message',
            payload: {
              title: 'Карточка требует подробной проверки',
              body: summary,
              severity: 'warning',
              actionUrl,
            },
            dataClass,
            contextCardId: item.resourceId,
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: item.tenantId,
            itemId: item.id,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'curation: ошибка dispatchProbe — пропускаю получателя',
        );
      }
    }
  }

  private buildProbeSummary(item: CurationItem): string {
    const conf = this.extractConfidenceFromReason(item.triageReason);
    const confText = conf !== undefined ? ` (уверенность ${(conf * 100).toFixed(0)}%)` : '';
    return `На проверке карточка ${item.resourceType} ${item.resourceId}${confText} — уровень: ${item.level}.`;
  }

  private extractConfidenceFromReason(reason: Prisma.JsonValue): number | undefined {
    if (
      reason &&
      typeof reason === 'object' &&
      !Array.isArray(reason) &&
      'confidence' in reason
    ) {
      const v = (reason as Record<string, unknown>).confidence;
      if (typeof v === 'number') return v;
    }
    return undefined;
  }

  private normalizeSettings(raw: Prisma.JsonValue | null): CurationSettingsDto {
    const def: CurationSettingsDto = {
      autoThreshold: this.cfg.curation.autoThresholdDefault ?? DEFAULT_AUTO_THRESHOLD,
      deepReviewThreshold:
        this.cfg.curation.deepReviewThresholdDefault ?? DEFAULT_DEEP_REVIEW_THRESHOLD,
      criticalTypes:
        (this.cfg.curation.criticalTypesDefault as readonly string[])?.slice() ??
        [...DEFAULT_CRITICAL_TYPES],
      itemExpiryDays: this.cfg.curation.itemExpiryDays ?? 30,
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
    const obj = raw as Record<string, unknown>;
    return {
      autoThreshold:
        typeof obj.autoThreshold === 'number' ? obj.autoThreshold : def.autoThreshold,
      deepReviewThreshold:
        typeof obj.deepReviewThreshold === 'number'
          ? obj.deepReviewThreshold
          : def.deepReviewThreshold,
      criticalTypes: Array.isArray(obj.criticalTypes)
        ? (obj.criticalTypes.filter(
            (s): s is string => typeof s === 'string',
          ) as string[])
        : def.criticalTypes,
      itemExpiryDays:
        typeof obj.itemExpiryDays === 'number'
          ? obj.itemExpiryDays
          : def.itemExpiryDays,
    };
  }

  // ──────────────────────────── mappers ─────────────────────────

  private toItemDto(item: CurationItem): CurationItemDto {
    return {
      id: item.id,
      tenantId: item.tenantId,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      level: item.level as CurationLevelDto,
      triageReason: jsonObj(item.triageReason),
      proposedPayload: jsonObj(item.proposedPayload),
      status: item.status,
      assignedToUserId: item.assignedToUserId,
      candidateCuratorIds: item.candidateCuratorIds,
      createdAt: item.createdAt.toISOString(),
      decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null,
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
    };
  }

  private toDecisionDto(d: {
    id: string;
    curationItemId: string;
    decisionType: CurationDecisionType;
    payload: Prisma.JsonValue;
    reasoning: string | null;
    reviewerUserId: string;
    createdAt: Date;
  }): CurationDecisionDto {
    return {
      id: d.id,
      curationItemId: d.curationItemId,
      decisionType: d.decisionType as CurationDecisionTypeDto,
      payload: jsonObj(d.payload),
      reasoning: d.reasoning,
      reviewerUserId: d.reviewerUserId,
      createdAt: d.createdAt.toISOString(),
    };
  }
}

function jsonObj(v: Prisma.JsonValue): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
