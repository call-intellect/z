import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { IntakeService } from '../../tracker/services/intake.service';
import { ConflictPendingProvider } from '../providers/conflict.provider';
import { CurationPendingProvider } from '../providers/curation.provider';
import { IntakePendingProvider } from '../providers/intake.provider';
import type {
  PendingActionItem,
  PendingActionsProvider,
} from '../providers/pending-actions-provider.types';
import { ProbePendingProvider } from '../providers/probe.provider';

export type PendingActionSource = PendingActionItem['source'];

export interface PendingActionsCountResult {
  total: number;
  bySource: Record<PendingActionSource, number>;
}

export interface PendingActionsListResult {
  items: PendingActionItem[];
}

export interface SnoozeInput {
  tenantId: string;
  userId: string;
  source: PendingActionSource;
  resourceType: string;
  resourceId: string;
  hours: number;
}

/** Стратегия резолва (зависит от source). См. DTO ConfirmResolutionSchema. */
export type ConfirmResolution =
  | 'approve'
  | 'reject'
  | 'keep_old'
  | 'accept_new'
  | 'merge'
  | 'accept';

export interface ConfirmInput {
  tenantId: string;
  userId: string;
  source: PendingActionSource;
  resourceId: string;
  /// Стратегия резолва (curation опц.; conflict/intake обязательна; probe — нет).
  resolution?: ConfirmResolution;
  /// Свободный ответ на probe-вопрос (только source='probe').
  answerText?: string;
  /// Целевой проект для intake accept.
  targetProjectId?: string;
}

const SNOOZE_MIN_HOURS = 1;
const SNOOZE_MAX_HOURS = 720;

/**
 * PendingActionsService — единый агрегатор «что требует действия пользователя»
 * (Action Center B0, 2026-06-02). Фундамент Части B: его потребляют бейдж,
 * колокольчик, дашборд CEO и Telegram.
 *
 * Резолвит роль пользователя в tenant (Membership) → передаёт её провайдерам
 * (owner/admin видят всё по своим источникам). Snooze (PendingActionSnooze)
 * исключается из count/list: провайдер получает множество отложенных
 * resourceId'ов своего источника и фильтрует их в SQL.
 */
@Injectable()
export class PendingActionsService {
  private readonly logger = new Logger(PendingActionsService.name);
  private readonly providers: PendingActionsProvider[];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurationPendingProvider)
    private readonly curation: CurationPendingProvider,
    @Inject(ConflictPendingProvider)
    private readonly conflict: ConflictPendingProvider,
    @Inject(IntakePendingProvider)
    private readonly intake: IntakePendingProvider,
    @Inject(ProbePendingProvider)
    private readonly probe: ProbePendingProvider,
    // Action Center B4 — делегат быстрого подтверждения light-curation.
    @Inject(CurationService)
    private readonly curationService: CurationService,
    // Редизайн Ф4 — делегаты сквозного резолва остальных источников.
    @Inject(ConflictService)
    private readonly conflictService: ConflictService,
    @Inject(IntakeService)
    private readonly intakeService: IntakeService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {
    // Порядок фиксирован — детерминизм для bySource/тестов.
    this.providers = [this.curation, this.conflict, this.intake, this.probe];
  }

  // ──────────────────────────── count ─────────────────────────────

  async getCount(args: {
    tenantId: string;
    userId: string;
  }): Promise<PendingActionsCountResult> {
    const role = await this.resolveRole(args.tenantId, args.userId);
    const snoozed = await this.loadSnoozedBySource(args.tenantId, args.userId);

    const bySource = {
      curation: 0,
      conflict: 0,
      intake: 0,
      probe: 0,
    } as Record<PendingActionSource, number>;

    await Promise.all(
      this.providers.map(async (p) => {
        bySource[p.source] = await p.countForUser({
          tenantId: args.tenantId,
          userId: args.userId,
          role,
          snoozedResourceIds: snoozed[p.source],
        });
      }),
    );

    const total =
      bySource.curation + bySource.conflict + bySource.intake + bySource.probe;
    return { total, bySource };
  }

  // ──────────────────────────── list ──────────────────────────────

  async getList(args: {
    tenantId: string;
    userId: string;
    limit: number;
  }): Promise<PendingActionsListResult> {
    const role = await this.resolveRole(args.tenantId, args.userId);
    const snoozed = await this.loadSnoozedBySource(args.tenantId, args.userId);

    // Каждый провайдер отдаёт не более `limit` — объединяем, сортируем
    // urgent-first затем по ageDays desc, и обрезаем до limit.
    const lists = await Promise.all(
      this.providers.map((p) =>
        p.listForUser({
          tenantId: args.tenantId,
          userId: args.userId,
          role,
          limit: args.limit,
          snoozedResourceIds: snoozed[p.source],
        }),
      ),
    );

    const merged = lists.flat();
    merged.sort((a, b) => {
      const aUrgent = a.severity === 'urgent' ? 1 : 0;
      const bUrgent = b.severity === 'urgent' ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent; // urgent-first
      return b.ageDays - a.ageDays; // затем самые старые сверху
    });

    return { items: merged.slice(0, args.limit) };
  }

  // ──────────────────────────── snooze ────────────────────────────

  async snooze(input: SnoozeInput): Promise<{ ok: true; snoozedUntil: string }> {
    if (
      !Number.isInteger(input.hours) ||
      input.hours < SNOOZE_MIN_HOURS ||
      input.hours > SNOOZE_MAX_HOURS
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_snooze_hours',
          message: `hours должен быть целым в диапазоне [${SNOOZE_MIN_HOURS}..${SNOOZE_MAX_HOURS}]`,
        },
      });
    }
    const snoozedUntil = new Date(Date.now() + input.hours * 60 * 60 * 1000);
    await this.prisma.pendingActionSnooze.upsert({
      where: {
        tenantId_userId_source_resourceId: {
          tenantId: input.tenantId,
          userId: input.userId,
          source: input.source,
          resourceId: input.resourceId,
        },
      },
      create: {
        tenantId: input.tenantId,
        userId: input.userId,
        source: input.source,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        snoozedUntil,
      },
      update: {
        resourceType: input.resourceType,
        snoozedUntil,
      },
    });
    this.logger.log(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        source: input.source,
        resourceId: input.resourceId,
        hours: input.hours,
      },
      'pending-actions.snooze: item отложен',
    );
    return { ok: true, snoozedUntil: snoozedUntil.toISOString() };
  }

  // ──────────────────────── confirm (Ф4 — сквозной резолв) ────────

  /**
   * Сквозной резолв item'а единой очереди решений (редизайн Ф4, 2026-06-13).
   * Диспетчер по `source` → профильный сервис-резолвер. Все источники
   * валидируют tenantId-владение и status внутри своих сервисов; ошибки
   * (BadRequest/Forbidden/NotFound) пробрасываются наружу. Повторный резолв
   * уже резолвнутого ресурса — понятная ошибка/no-op, не 500.
   *
   * Возвращает `{ ok: true }` — детали резолва берутся из профильных API.
   */
  async confirm(input: ConfirmInput): Promise<{ ok: true }> {
    switch (input.source) {
      case 'curation':
        await this.confirmCuration(input);
        return { ok: true };
      case 'conflict':
        await this.confirmConflict(input);
        return { ok: true };
      case 'intake':
        await this.confirmIntake(input);
        return { ok: true };
      case 'probe':
        await this.confirmProbe(input);
        return { ok: true };
      default: {
        // exhaustive — на случай расширения source без обновления switch.
        const _never: never = input.source;
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'confirm_unsupported_source',
            message: `Источник '${String(_never)}' не поддерживается`,
          },
        });
      }
    }
  }

  /**
   * curation: light-карточка → approve (one-tap, B4) либо reject. RBAC,
   * status==='pending' и reasoning-окно — внутри `decide`.
   */
  private async confirmCuration(input: ConfirmInput): Promise<void> {
    const decision: 'approve' | 'reject' =
      input.resolution === 'reject' ? 'reject' : 'approve';

    const item = await this.prisma.curationItem.findUnique({
      where: { id: input.resourceId },
      select: { id: true, tenantId: true, status: true, level: true },
    });
    if (!item || item.tenantId !== input.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'curation_item_not_found',
          message: 'CurationItem не найден',
        },
      });
    }
    if (item.status !== 'pending') {
      // Идемпотентность: уже резолвнут — понятная ошибка, не 500.
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'curation_item_not_pending',
          message: `CurationItem уже в статусе ${item.status}`,
        },
      });
    }
    if (item.level !== 'light') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'quick_confirm_only_light',
          message:
            'Быстрое подтверждение доступно только для лёгких карточек — критические подтверждаются на странице карточки',
        },
      });
    }

    // decide сам проверяет RBAC (reviewer ∈ candidateCuratorIds | owner/admin),
    // повторно валидирует status==='pending'. ForbiddenException → 403 наружу.
    await this.curationService.decide({
      tenantId: input.tenantId,
      curationItemId: input.resourceId,
      reviewerUserId: input.userId,
      decisionType: decision,
    });
    this.logger.log(
      { tenantId: input.tenantId, userId: input.userId, resourceId: input.resourceId, decision },
      'pending-actions.confirm: curation резолвнут',
    );
  }

  /**
   * conflict: keep_old | accept_new | merge → ConflictService.resolve.
   * `evolving` через быстрый резолв не поддерживаем (нужны даты evolvingMeta —
   * только на странице конфликта). tenantId-владение и status==='open' —
   * внутри resolve (повторный → BadRequest 'conflict_not_open', не 500).
   */
  private async confirmConflict(input: ConfirmInput): Promise<void> {
    const allowed = ['keep_old', 'accept_new', 'merge'] as const;
    if (
      !input.resolution ||
      !(allowed as readonly string[]).includes(input.resolution)
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'conflict_resolution_required',
          message:
            "Для конфликта нужен resolution ∈ keep_old | accept_new | merge",
        },
      });
    }
    await this.conflictService.resolve({
      tenantId: input.tenantId,
      conflictId: input.resourceId,
      reviewerUserId: input.userId,
      resolution: input.resolution as 'keep_old' | 'accept_new' | 'merge',
    });
    this.logger.log(
      { tenantId: input.tenantId, userId: input.userId, resourceId: input.resourceId, resolution: input.resolution },
      'pending-actions.confirm: conflict резолвнут',
    );
  }

  /**
   * intake: accept | reject → IntakeService.triage. Для accept проект берётся
   * из targetProjectId / привязки / suggested (логика внутри triage). Если
   * проекта нет — triage кидает BadRequest 'target_project_required' (наружу,
   * не 500). Повторный триаж → BadRequest 'intake_already_triaged'.
   */
  private async confirmIntake(input: ConfirmInput): Promise<void> {
    const decision = input.resolution;
    if (decision !== 'accept' && decision !== 'reject') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'intake_resolution_required',
          message: 'Для входящей задачи нужен resolution ∈ accept | reject',
        },
      });
    }
    await this.intakeService.triage(
      input.resourceId,
      {
        decision,
        targetProjectId: input.targetProjectId ?? null,
      } as never,
      input.tenantId,
      input.userId,
    );
    this.logger.log(
      { tenantId: input.tenantId, userId: input.userId, resourceId: input.resourceId, decision },
      'pending-actions.confirm: intake резолвнут',
    );
  }

  /**
   * probe: свободный ответ текстом → ConversationalService.respondToProbe.
   * Владение (recipientUserId), идемпотентность (answered → no-op) и срок
   * (expiresAt) — внутри respondToProbe (Forbidden/BadRequest наружу).
   */
  private async confirmProbe(input: ConfirmInput): Promise<void> {
    const text = input.answerText?.trim();
    if (!text) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'probe_answer_required',
          message: 'Для ответа на вопрос нужен непустой answerText',
        },
      });
    }
    await this.conversational.respondToProbe({
      notificationId: input.resourceId,
      userId: input.userId,
      payload: { text },
    });
    this.logger.log(
      { tenantId: input.tenantId, userId: input.userId, resourceId: input.resourceId },
      'pending-actions.confirm: probe отвечен',
    );
  }

  // ──────────────────────────── helpers ───────────────────────────

  /** Роль пользователя в tenant (Membership) или null, если не член Org. */
  private async resolveRole(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: tenantId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /**
   * Активные snooze пользователя, сгруппированные по source. resourceId'ы
   * каждого источника передаются провайдеру для SQL-фильтрации.
   */
  private async loadSnoozedBySource(
    tenantId: string,
    userId: string,
  ): Promise<Record<PendingActionSource, Set<string>>> {
    const rows = await this.prisma.pendingActionSnooze.findMany({
      where: {
        tenantId,
        userId,
        snoozedUntil: { gt: new Date() },
      },
      select: { source: true, resourceId: true },
    });
    const out: Record<PendingActionSource, Set<string>> = {
      curation: new Set(),
      conflict: new Set(),
      intake: new Set(),
      probe: new Set(),
    };
    for (const r of rows) {
      const bucket = out[r.source as PendingActionSource];
      if (bucket) bucket.add(r.resourceId);
    }
    return out;
  }
}
