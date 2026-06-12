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
  type TrustTier,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { levelRu, resourceTypeRu } from '../../pending-actions/resource-type-ru';
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
  OverrideStatsItemDto,
  OverrideStatsResponse,
  ProvisionalAuditStatsItemDto,
  ProvisionalAuditStatsResponse,
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

/**
 * Action Center A1 «лестница доверия» (2026-06-02) — добавлен маркер
 * `'provisional'`: критическая карточка прошла AI-судью (3-голосовый
 * debate-консенсус accept) и канонизирована провизорно (trustTier=provisional),
 * минуя человека. По форме результата идентичен `'auto'` (есть cardVersionId,
 * нет curationItemId — кроме случая попадания в аудит-выборку).
 */
export type TriageDecision = 'auto' | 'provisional' | 'light' | 'deep';

export interface TriageResult {
  decision: TriageDecision;
  /** Если 'auto' | 'provisional' — id созданного CardVersion. Иначе — null. */
  cardVersionId: string | null;
  /**
   * Если 'light' | 'deep' — id созданного CurationItem. Для 'auto'/'provisional'
   * обычно null, НО если решение попало в аудит-выборку — id лёгкого
   * аудит-CurationItem (не блокирующего; карточка уже канонизирована).
   */
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
// Action Center A1 «лестница доверия» (2026-06-02). Используются как
// последний parse-fallback в normalizeSettings/triage; платформенные дефолты
// `def` теперь берутся из cfg.curation (AdminSetting → ENV → default).
const DEFAULT_PROVISIONAL_THRESHOLD = 0.8;
const DEFAULT_AUDIT_SAMPLE_RATE = 0.05;
// Action Center A2 «лестница доверия» (2026-06-02) — autotune + kill-switch.
/**
 * A2 — значение порога, эффективно отключающее провизорный путь для типа:
 * triage сравнивает `effectiveConfidence >= provisionalT`; при 1.01 условие
 * никогда не выполняется (confidence clamped в [0..1]) → критический тип
 * безопасно уходит к человеку (deep), как до A1. Используется kill-switch'ем
 * в `CurationAutotuneCron`.
 */
export const KILL_SWITCH_PROVISIONAL_THRESHOLD = 1.01;

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
    /**
     * Action Center A1 «лестница доверия» (2026-06-02) — AI-судья
     * (3-голосовый debate) для провизорной канонизации критических карточек.
     * @Optional, потому что CurationModule поднимается и в worker-процессе,
     * где AiModule может отсутствовать. Если null — критические карточки
     * безопасно идут к человеку (deep), как раньше.
     */
    @Optional()
    @Inject(MultiAgentDebateService)
    private readonly debate: MultiAgentDebateService | null = null,
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

    // A0 «лестница доверия» (2026-06-02) — пер-типовые пороги перекрывают
    // глобальные для конкретного resourceType. Если карта не задана или в ней
    // нет типа — fallback на глобальный порог (обратносовместимо). Гейты
    // criticalTypes / conflict='hard' НЕ затрагиваются.
    const autoT =
      settings.autoThresholdByType?.[input.resourceType] ?? settings.autoThreshold;
    const deepT =
      settings.deepReviewThresholdByType?.[input.resourceType] ??
      settings.deepReviewThreshold;
    // A1 — порог провизорной AI-канонизации критического типа (пер-типовый
    // override → глобальный).
    const provisionalT =
      settings.provisionalThresholdByType?.[input.resourceType] ??
      settings.provisionalThreshold ??
      DEFAULT_PROVISIONAL_THRESHOLD;

    // 1. auto-canonical (некритический тип, без конфликта, high confidence).
    if (!isCritical && conflict === 'none' && effectiveConfidence >= autoT) {
      const version = await this.createInitialCardVersion(input, 'auto');
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
      const auditItemId = await this.maybeCreateAuditSample({
        input,
        settings,
        trustTier: 'auto',
      });
      return {
        decision: 'auto',
        cardVersionId: version.id,
        curationItemId: auditItemId,
        candidateCuratorIds: [],
      };
    }

    // 1b. A1 «лестница доверия» — провизорная AI-канонизация критического типа.
    // Критический тип (regulation/process/decision) больше НЕ блокируется
    // человеком безусловно: уверенная карточка без hard-конфликта проходит
    // AI-судью (3-голосовый debate); при accept-консенсусе становится
    // провизорно-канонической (trustTier=provisional), минуя человека.
    // Все остальные гейты (conflict='hard', низкая confidence) сохранены.
    if (
      isCritical &&
      conflict !== 'hard' &&
      settings.aiVerifierEnabled &&
      this.debate &&
      effectiveConfidence >= provisionalT
    ) {
      const verdict = await this.runAiVerifier(input);
      const accepted =
        verdict !== null &&
        verdict.decision === 'accept' &&
        (verdict.consensusType === 'unanimous' ||
          verdict.consensusType === 'majority');
      this.metrics.incCurationVerifierVerdict({
        decision: verdict?.decision ?? 'unavailable',
        consensusType: verdict?.consensusType ?? 'unavailable',
      });
      if (accepted) {
        const version = await this.createInitialCardVersion(input, 'provisional');
        this.metrics.incCurationProvisional({ resourceType: input.resourceType });
        this.logger.log(
          {
            tenantId: input.tenantId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            versionId: version.id,
            consensusType: verdict?.consensusType,
          },
          'curation.triage: provisional-canonical (AI-судья accept)',
        );
        const auditItemId = await this.maybeCreateAuditSample({
          input,
          settings,
          trustTier: 'provisional',
        });
        return {
          decision: 'provisional',
          cardVersionId: version.id,
          curationItemId: auditItemId,
          candidateCuratorIds: [],
        };
      }
      // reject / split / verifier недоступен → безопасный fallback к человеку
      // (deep CurationItem) ниже. Метрика verifier-verdict уже записана.
      this.logger.log(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          verdict: verdict?.decision ?? 'unavailable',
          consensusType: verdict?.consensusType ?? 'unavailable',
        },
        'curation.triage: AI-судья НЕ дал accept-консенсус → deep review (человек)',
      );
    }

    // 2. deep / light
    let level: CurationLevel;
    if (isCritical || conflict === 'hard' || effectiveConfidence < deepT) {
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
      // A0 — фактически применённые пороги (с учётом пер-типового override).
      autoThreshold: autoT,
      deepReviewThreshold: deepT,
      // Глобальные пороги для прозрачности (видно, был ли override).
      autoThresholdGlobal: settings.autoThreshold,
      deepThresholdGlobal: settings.deepReviewThreshold,
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
          // A1 — решение человека-куратора → метка доверия 'human'.
          trustTier: 'human',
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

  // ──────────────────────────── submitProposal ─────────────────────
  /**
   * Action Center E1 «поправить карточку знаний» (2026-06-04) — пользователь
   * без write-права предлагает правку провизорной карточки. Вместо 403-тупика
   * создаём `CurationItem(level='light', status='pending')` с
   * `triageReason.via='user_correction'` и `proposedPayload` = предложенными
   * полями. Куратор (owner/admin или ассайнментный) увидит это в очереди и
   * примет/отклонит. Анти-вандализм: правка НЕ применяется напрямую.
   *
   * Best-effort: ошибка разрешения кураторов или инкремента метрики не валит
   * создание item'а (карточка останется в очереди с candidateCuratorIds=[],
   * lifecycle-cron подберёт owner/admin при экспирации).
   */
  async submitProposal(input: {
    tenantId: string;
    resourceType: string;
    resourceId: string;
    proposedPayload: Record<string, unknown>;
    submittedBy: string;
    reason?: string | null;
  }): Promise<{ curationItemId: string }> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_submit_proposal_input',
          message:
            'tenantId / resourceType / resourceId обязательны для предложения правки',
        },
      });
    }
    if (!input.submittedBy) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'submitted_by_required',
          message: 'submittedBy (User.id) обязателен',
        },
      });
    }

    let candidateCuratorIds: string[] = [];
    try {
      candidateCuratorIds = await this.routing.resolveCurators({
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        level: 'light',
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.submitProposal: resolveCurators упал (best-effort, candidates=[])',
      );
      // candidateCuratorIds остаётся [] (инициализировано выше).
    }

    const triageReason = {
      via: 'user_correction',
      reason: input.reason ?? null,
      submittedBy: input.submittedBy,
    };

    const item = await this.prisma.curationItem.create({
      data: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        level: 'light',
        status: 'pending',
        triageReason: triageReason as Prisma.InputJsonValue,
        proposedPayload: input.proposedPayload as Prisma.InputJsonValue,
        candidateCuratorIds,
      },
    });

    try {
      this.metrics.incCurationItem({
        resourceType: input.resourceType,
        level: 'light',
        status: 'pending',
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.submitProposal: incCurationItem упал (best-effort)',
      );
    }

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        submittedBy: input.submittedBy,
        candidateCuratorIds,
      },
      'curation.submitProposal: правка-предложение поставлена в очередь курации',
    );

    return { curationItemId: item.id };
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

  // ──────────────────────────── override stats (A0) ───────────────

  /**
   * A0 «лестница доверия» (2026-06-02) — read-model override-rate по
   * resourceType. Для каждого типа считает долю «переопределений» куратором
   * (reject + approve_with_edits) среди items с финальным решением.
   *
   * Финальное решение = ПОСЛЕДНЕЕ по createdAt решение типа ≠ 'escalate'
   * (escalate — это переадресация, не финал; item остаётся pending до
   * настоящего решения). Items вообще без не-escalate решений не считаются
   * decided.
   *
   * Высокий overrideRate сигналит: для типа порог auto-canonical занижен —
   * кандидат на ручную/будущую авто-подстройку autoThresholdByType.
   */
  async getOverrideStats(args: { tenantId: string }): Promise<OverrideStatsResponse> {
    const items = await this.prisma.curationItem.findMany({
      where: { tenantId: args.tenantId },
      select: {
        resourceType: true,
        decisions: { select: { decisionType: true, createdAt: true } },
      },
    });

    interface Acc {
      totalDecided: number;
      approve: number;
      approveWithEdits: number;
      reject: number;
      other: number;
    }
    const byType = items.reduce<Map<string, Acc>>((map, item) => {
      // Финал = последнее по createdAt решение ≠ 'escalate'.
      const finalDecision = item.decisions
        .filter((d) => d.decisionType !== 'escalate')
        .reduce<{ decisionType: string; createdAt: Date } | null>((latest, d) => {
          if (!latest || d.createdAt.getTime() > latest.createdAt.getTime()) {
            return d;
          }
          return latest;
        }, null);
      if (!finalDecision) return map; // нет финального решения — не decided.

      const acc =
        map.get(item.resourceType) ??
        { totalDecided: 0, approve: 0, approveWithEdits: 0, reject: 0, other: 0 };
      acc.totalDecided += 1;
      switch (finalDecision.decisionType) {
        case 'approve':
          acc.approve += 1;
          break;
        case 'approve_with_edits':
          acc.approveWithEdits += 1;
          break;
        case 'reject':
          acc.reject += 1;
          break;
        default:
          // split / merge / supersede / mark_as_misleading / merge_categories.
          acc.other += 1;
          break;
      }
      map.set(item.resourceType, acc);
      return map;
    }, new Map());

    const result: OverrideStatsItemDto[] = [...byType.entries()].map(
      ([resourceType, acc]) => ({
        resourceType,
        totalDecided: acc.totalDecided,
        approve: acc.approve,
        approveWithEdits: acc.approveWithEdits,
        reject: acc.reject,
        other: acc.other,
        overrideRate:
          acc.totalDecided > 0
            ? (acc.reject + acc.approveWithEdits) / acc.totalDecided
            : 0,
      }),
    );
    // Стабильный порядок — по resourceType (детерминизм для UI/тестов).
    result.sort((a, b) => a.resourceType.localeCompare(b.resourceType));
    return { items: result };
  }

  // ──────────────────── provisional audit stats (A2) ──────────────

  /**
   * A2 «лестница доверия» (2026-06-02) — read-model «провизорной ошибки»
   * по resourceType. Сигнал для kill-switch: насколько часто провизорно
   * канонизированные карточки (прошедшие AI-судью) оказываются неверными при
   * выборочной человеческой проверке.
   *
   * Считаем ТОЛЬКО аудит-выборку — CurationItem с
   * `triageReason.reason='audit_sample'`, по которым принято финальное решение
   * (status='decided'). Финал = последнее по createdAt решение ≠ 'escalate'
   * (как в getOverrideStats).
   *
   * `auditWrong` — финальное решение ∈ {reject, mark_as_misleading, supersede}.
   * Обоснование выбора: эти три типа означают «провизорная карточка была
   * неверной» — её отклонили (reject), пометили вводящей в заблуждение
   * (mark_as_misleading) или заменили другой версией (supersede). approve /
   * approve_with_edits / split / merge — НЕ считаем ошибкой (карточка по сути
   * подтверждена, возможно с правками/декомпозицией).
   *
   * `provisionalWrongRate = auditWrong / auditDecided` (0 при auditDecided=0).
   */
  async getProvisionalAuditStats(args: {
    tenantId: string;
  }): Promise<ProvisionalAuditStatsResponse> {
    const items = await this.prisma.curationItem.findMany({
      where: { tenantId: args.tenantId, status: 'decided' },
      select: {
        resourceType: true,
        triageReason: true,
        decisions: { select: { decisionType: true, createdAt: true } },
      },
    });

    const WRONG_TYPES = new Set(['reject', 'mark_as_misleading', 'supersede']);
    interface Acc {
      auditDecided: number;
      auditWrong: number;
    }
    const byType = items.reduce<Map<string, Acc>>((map, item) => {
      // Только аудит-выборка (triageReason.reason='audit_sample').
      if (!this.isAuditSample(item.triageReason)) return map;

      const finalDecision = item.decisions
        .filter((d) => d.decisionType !== 'escalate')
        .reduce<{ decisionType: string; createdAt: Date } | null>((latest, d) => {
          if (!latest || d.createdAt.getTime() > latest.createdAt.getTime()) {
            return d;
          }
          return latest;
        }, null);
      if (!finalDecision) return map; // нет финального решения — не decided.

      const acc = map.get(item.resourceType) ?? { auditDecided: 0, auditWrong: 0 };
      acc.auditDecided += 1;
      if (WRONG_TYPES.has(finalDecision.decisionType)) acc.auditWrong += 1;
      map.set(item.resourceType, acc);
      return map;
    }, new Map());

    const result: ProvisionalAuditStatsItemDto[] = [...byType.entries()].map(
      ([resourceType, acc]) => ({
        resourceType,
        auditDecided: acc.auditDecided,
        auditWrong: acc.auditWrong,
        provisionalWrongRate:
          acc.auditDecided > 0 ? acc.auditWrong / acc.auditDecided : 0,
      }),
    );
    result.sort((a, b) => a.resourceType.localeCompare(b.resourceType));
    return { items: result };
  }

  /** A2 — true, если CurationItem.triageReason.reason === 'audit_sample'. */
  private isAuditSample(reason: Prisma.JsonValue): boolean {
    return (
      !!reason &&
      typeof reason === 'object' &&
      !Array.isArray(reason) &&
      (reason as Record<string, unknown>).reason === 'audit_sample'
    );
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
    // A0 — пер-типовые карты заменяются целиком (если переданы), иначе
    // сохраняются текущие. Нормализуем, чтобы в БД легли только валидные записи.
    const autoByType = this.normalizeThresholdMap(
      args.patch.autoThresholdByType ?? current.autoThresholdByType ?? {},
    );
    const deepByType = this.normalizeThresholdMap(
      args.patch.deepReviewThresholdByType ?? current.deepReviewThresholdByType ?? {},
    );
    // A1 — пер-типовая карта провизорных порогов (как auto/deep).
    const provisionalByType = this.normalizeThresholdMap(
      args.patch.provisionalThresholdByType ??
        current.provisionalThresholdByType ??
        {},
    );
    const next: CurationSettingsDto = {
      autoThreshold: args.patch.autoThreshold ?? current.autoThreshold,
      deepReviewThreshold:
        args.patch.deepReviewThreshold ?? current.deepReviewThreshold,
      criticalTypes: args.patch.criticalTypes ?? current.criticalTypes,
      itemExpiryDays: args.patch.itemExpiryDays ?? current.itemExpiryDays,
      autoThresholdByType: autoByType,
      deepReviewThresholdByType: deepByType,
      // A1 «лестница доверия».
      provisionalThreshold:
        args.patch.provisionalThreshold ?? current.provisionalThreshold,
      provisionalThresholdByType: provisionalByType,
      aiVerifierEnabled:
        args.patch.aiVerifierEnabled ?? current.aiVerifierEnabled,
      auditSampleRate: args.patch.auditSampleRate ?? current.auditSampleRate,
      // A2 «лестница доверия» — autotune + kill-switch guardrails.
      autotuneEnabled: args.patch.autotuneEnabled ?? current.autotuneEnabled,
      thresholdMin: args.patch.thresholdMin ?? current.thresholdMin,
      thresholdMax: args.patch.thresholdMax ?? current.thresholdMax,
      autotuneStep: args.patch.autotuneStep ?? current.autotuneStep,
      minDecisionsForAutotune:
        args.patch.minDecisionsForAutotune ?? current.minDecisionsForAutotune,
      maxProvisionalOverride:
        args.patch.maxProvisionalOverride ?? current.maxProvisionalOverride,
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
    // A0 — инвариант auto ≥ deep сохраняется и на уровне каждого типа,
    // присутствующего в обеих картах (иначе у типа нет «light»-окна).
    for (const [type, autoVal] of Object.entries(autoByType)) {
      const deepVal = deepByType[type];
      if (deepVal !== undefined && autoVal < deepVal) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_thresholds',
            message: `autoThresholdByType[${type}] должен быть >= deepReviewThresholdByType[${type}]`,
          },
        });
      }
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
   * Создаёт первую CardVersion (`version=1`) для auto/provisional canonical.
   * A1 — `trustTier` помечает уровень доверия (auto | provisional).
   */
  private async createInitialCardVersion(
    input: TriageInput,
    trustTier: TrustTier,
  ) {
    return this.appendCardVersion(this.prisma, {
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.proposedPayload,
      changeReason: 'initial',
      createdByUserId: input.createdByUserId ?? null,
      curationDecisionId: null,
      curationItemId: null,
      trustTier,
    });
  }

  /**
   * A1 «лестница доверия» — вызов AI-судьи (3-голосовый debate, семейство
   * `curation-verify`) по готовому payload'у критической карточки.
   *
   * Возвращает DebateVerdict или null при любой проблеме (debate недоступен,
   * judge бросил, fallbackUsed без голосов). Caller трактует null/неуверенный
   * verdict как «к человеку» (безопасный fallback).
   */
  private async runAiVerifier(input: TriageInput): Promise<DebateVerdict | null> {
    if (!this.debate) return null;
    try {
      const verdict = await this.debate.judge({
        taskFamily: 'curation-verify',
        taskType: 'debate-curation-verify',
        task: `Карточка ${input.resourceType} корректна, обоснована и должна быть канонизирована в память компании? Verdict строго: accept | reject.`,
        candidates: [{ resourceType: input.resourceType, candidate: input.proposedPayload }],
        contextBlocks: [],
        tenantId: input.tenantId,
      });
      // Все голоса упали (fallbackUsed без votes) → трактуем как недоступность.
      if (verdict.fallbackUsed === 'provider_unavailable' && verdict.votes.length === 0) {
        return null;
      }
      return verdict;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'curation.runAiVerifier: debate.judge упал — fallback к человеку (deep)',
      );
      return null;
    }
  }

  /**
   * A1 — аудит-выборка: с вероятностью `auditSampleRate` создаёт ЛЁГКИЙ
   * (level='light', status='pending') аудит-CurationItem поверх уже
   * канонизированной (auto/provisional) карточки. НЕ блокирует канонизацию —
   * это пост-фактум выборочная человеческая проверка качества авто-решений.
   *
   * Возвращает id созданного аудит-item'а или null (не попал в выборку).
   */
  private async maybeCreateAuditSample(args: {
    input: TriageInput;
    settings: CurationSettingsDto;
    trustTier: TrustTier;
  }): Promise<string | null> {
    const rate = args.settings.auditSampleRate ?? DEFAULT_AUDIT_SAMPLE_RATE;
    if (!this.shouldSample(rate)) return null;
    try {
      const candidates = await this.routing.resolveCurators({
        tenantId: args.input.tenantId,
        resourceType: args.input.resourceType,
        level: 'light',
        criteria: args.input.criteria,
      });
      const item = await this.prisma.curationItem.create({
        data: {
          tenantId: args.input.tenantId,
          resourceType: args.input.resourceType,
          resourceId: args.input.resourceId,
          level: 'light',
          status: 'pending',
          triageReason: {
            reason: 'audit_sample',
            trustTier: args.trustTier,
            auditSampleRate: rate,
          } as Prisma.InputJsonValue,
          proposedPayload: args.input.proposedPayload as Prisma.InputJsonValue,
          candidateCuratorIds: candidates,
          expiresAt: this.expiryDate(args.settings.itemExpiryDays),
        },
      });
      this.metrics.incCurationItem({
        resourceType: args.input.resourceType,
        level: 'light',
        status: 'pending',
      });
      this.metrics.incCurationAuditSample({ resourceType: args.input.resourceType });
      await this.dispatchProbe({
        item,
        candidateCuratorIds: candidates,
        dataClass: args.input.dataClass,
      });
      this.logger.log(
        {
          tenantId: args.input.tenantId,
          itemId: item.id,
          resourceType: args.input.resourceType,
          trustTier: args.trustTier,
        },
        'curation.triage: создан аудит-CurationItem (audit_sample, не блокирует)',
      );
      return item.id;
    } catch (err) {
      // Best-effort: ошибка аудит-выборки не должна валить триаж.
      this.logger.warn(
        {
          tenantId: args.input.tenantId,
          resourceType: args.input.resourceType,
          err: err instanceof Error ? err.message : String(err),
        },
        'curation.maybeCreateAuditSample: не удалось создать аудит-item (best-effort)',
      );
      return null;
    }
  }

  /**
   * A1 — детерминированная обёртка над сэмплингом. Вынесена в метод, чтобы
   * тесты могли проверять граничные rate=1 (всегда) и rate=0 (никогда).
   */
  private shouldSample(rate: number): boolean {
    if (!Number.isFinite(rate) || rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
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
      /** A1 — уровень доверия версии. Default 'human' (создаётся человеком). */
      trustTier?: TrustTier;
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
        trustTier: args.trustTier ?? 'human',
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
    return `На проверке карточка «${resourceTypeRu(item.resourceType)}»${confText} — уровень: ${levelRu(item.level)}.`;
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
      // A0 — пер-типовые пороги по умолчанию пусты (нет override).
      autoThresholdByType: {},
      deepReviewThresholdByType: {},
      // A1 «лестница доверия» — платформенные дефолты из AdminSetting/cfg.
      provisionalThreshold: this.cfg.curation.provisionalThresholdDefault,
      provisionalThresholdByType: {},
      aiVerifierEnabled: this.cfg.curation.aiVerifierEnabled,
      auditSampleRate: this.cfg.curation.auditSampleRate,
      // A2 «лестница доверия» — autotune + kill-switch guardrails из AdminSetting/cfg.
      autotuneEnabled: this.cfg.curation.autotuneEnabled,
      thresholdMin: this.cfg.curation.thresholdMin,
      thresholdMax: this.cfg.curation.thresholdMax,
      autotuneStep: this.cfg.curation.autotuneStep,
      minDecisionsForAutotune: this.cfg.curation.minDecisionsForAutotune,
      maxProvisionalOverride: this.cfg.curation.maxProvisionalOverride,
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
      // A0 — парсим пер-типовые карты; невалидные записи отбрасываем,
      // отсутствие карты → {} (поведение как раньше).
      autoThresholdByType: this.normalizeThresholdMap(obj.autoThresholdByType),
      deepReviewThresholdByType: this.normalizeThresholdMap(
        obj.deepReviewThresholdByType,
      ),
      // A1 «лестница доверия» — провизорный порог / AI-судья / аудит-выборка.
      provisionalThreshold:
        typeof obj.provisionalThreshold === 'number' &&
        Number.isFinite(obj.provisionalThreshold) &&
        obj.provisionalThreshold >= 0 &&
        obj.provisionalThreshold <= 1
          ? obj.provisionalThreshold
          : def.provisionalThreshold,
      provisionalThresholdByType: this.normalizeThresholdMap(
        obj.provisionalThresholdByType,
      ),
      aiVerifierEnabled:
        typeof obj.aiVerifierEnabled === 'boolean'
          ? obj.aiVerifierEnabled
          : def.aiVerifierEnabled,
      auditSampleRate:
        typeof obj.auditSampleRate === 'number' &&
        Number.isFinite(obj.auditSampleRate) &&
        obj.auditSampleRate >= 0 &&
        obj.auditSampleRate <= 1
          ? obj.auditSampleRate
          : def.auditSampleRate,
      // A2 «лестница доверия» — autotune + kill-switch guardrails.
      autotuneEnabled:
        typeof obj.autotuneEnabled === 'boolean'
          ? obj.autotuneEnabled
          : def.autotuneEnabled,
      thresholdMin: this.parseUnit(obj.thresholdMin, def.thresholdMin),
      thresholdMax: this.parseUnit(obj.thresholdMax, def.thresholdMax),
      autotuneStep: this.parseUnit(obj.autotuneStep, def.autotuneStep),
      minDecisionsForAutotune:
        typeof obj.minDecisionsForAutotune === 'number' &&
        Number.isInteger(obj.minDecisionsForAutotune) &&
        obj.minDecisionsForAutotune >= 1
          ? obj.minDecisionsForAutotune
          : def.minDecisionsForAutotune,
      maxProvisionalOverride: this.parseUnit(
        obj.maxProvisionalOverride,
        def.maxProvisionalOverride,
      ),
    };
  }

  /**
   * A2 — парс числа в [0..1] с fallback на дефолт (для guardrail-настроек).
   * `fallback` приходит из `def.X` (= cfg.curation.X, admin-дефолт); поле в
   * `CurationSettingsDto` опционально, поэтому тип допускает `undefined` —
   * в рантайме cfg всегда отдаёт число (см. typed-config.service guardrails).
   */
  private parseUnit(
    raw: unknown,
    fallback: number | undefined,
  ): number | undefined {
    return typeof raw === 'number' &&
      Number.isFinite(raw) &&
      raw >= 0 &&
      raw <= 1
      ? raw
      : fallback;
  }

  /**
   * A0 «лестница доверия» — валидация пер-типовой карты порогов.
   * Принимает только записи `{ [resourceType: string]: number в [0..1] }`;
   * всё прочее (не-объект, нечисловые/вне-диапазона значения) отбрасывается.
   * Возвращает `{}` для отсутствующей/невалидной карты.
   */
  private normalizeThresholdMap(
    raw: unknown,
  ): Record<string, number> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const type = key.trim();
      if (
        type.length >= 1 &&
        type.length <= 80 &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      ) {
        out[type] = value;
      }
    }
    return out;
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
