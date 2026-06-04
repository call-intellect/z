import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { CurationItem } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurationService } from '../../curation/services/curation.service';
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

export interface ConfirmInput {
  tenantId: string;
  userId: string;
  source: PendingActionSource;
  resourceId: string;
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

  // ──────────────────────────── confirm (B4) ──────────────────────

  /**
   * Action Center B4 «быстрый путь подтверждения» (2026-06-02).
   *
   * One-tap подтверждение item'а прямо из feed'а. Поддерживается ТОЛЬКО
   * `source==='curation'` для light-уровня — делегирует
   * `CurationService.decide({ decisionType: 'approve' })`. RBAC, проверка
   * status==='pending' и наличие reasoning-окна — внутри `decide`
   * (ForbiddenException/NotFound/BadRequest пробрасываются наружу).
   *
   * Критические / deep-карточки НЕ подтверждаются здесь — только на странице
   * карточки (где куратор обязан оставить обоснование).
   */
  async confirm(input: ConfirmInput): Promise<CurationItem> {
    if (input.source !== 'curation') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'quick_confirm_unsupported_source',
          message: 'Быстрое подтверждение доступно только для источника curation',
        },
      });
    }

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
    // повторно валидирует status==='pending' и для light+approve НЕ требует
    // reasoning. ForbiddenException из decide пробрасывается наружу как 403.
    const decided = await this.curationService.decide({
      tenantId: input.tenantId,
      curationItemId: input.resourceId,
      reviewerUserId: input.userId,
      decisionType: 'approve',
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        curationItemId: input.resourceId,
      },
      'pending-actions.confirm: light-карточка подтверждена (approve)',
    );
    return decided;
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
