import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { SupportAccessService } from './support-access.service';

/** Дефолтные SLA-таймеры, если для вендор-Org нет SupportSlaPolicy. */
const DEFAULT_FIRST_RESPONSE_MINS = 60;
const DEFAULT_RESOLUTION_MINS = 480;

/**
 * SupportSlaService — расчёт SLA-дедлайнов тикета и фиксация нарушений.
 * ТЗ 2026-06-09 support-desk Ф1 (R11/R12).
 *
 * Упрощение v1: `businessHoursOnly` игнорируется — дедлайны считаются как
 * createdAt + N минут календарно (рабочие часы — fast-follow).
 */
@Injectable()
export class SupportSlaService {
  private readonly logger = new Logger(SupportSlaService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
  ) {}

  /**
   * Дедлайны первого ответа и решения для нового тикета. Грузит
   * `SupportSlaPolicy` вендор-Org (синглтон); fallback на дефолты 60/480 мин.
   *
   * NB (v1): `businessHoursOnly` не учитывается — календарное прибавление минут.
   */
  async computeDueDates(
    vendorOrgId: string,
    createdAt: Date,
  ): Promise<{ firstResponseDueAt: Date; resolutionDueAt: Date }> {
    let firstResponseMins = DEFAULT_FIRST_RESPONSE_MINS;
    let resolutionMins = DEFAULT_RESOLUTION_MINS;
    try {
      const policy = await this.prisma.supportSlaPolicy.findUnique({
        where: { tenantId: vendorOrgId },
        select: { firstResponseMins: true, resolutionMins: true },
      });
      if (policy) {
        firstResponseMins = policy.firstResponseMins;
        resolutionMins = policy.resolutionMins;
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'computeDueDates: чтение SupportSlaPolicy упало — дефолты 60/480',
      );
    }
    const base = createdAt.getTime();
    return {
      firstResponseDueAt: new Date(base + firstResponseMins * 60_000),
      resolutionDueAt: new Date(base + resolutionMins * 60_000),
    };
  }

  /**
   * Пометить нарушения SLA первого ответа. Находит открытые support-тикеты
   * вендор-Org с истёкшим `firstResponseDueAt`, ещё не отвеченные клиенту и
   * без зафиксированного нарушения → проставляет `slaBreachedAt=now`.
   *
   * Возвращает число помеченных. Tenant-scoped по вендор-Org. «Открытый» =
   * state.category НЕ ∈ {completed, cancelled} (или state отсутствует).
   */
  async markBreaches(now: Date): Promise<number> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) return 0;

    const overdue = await this.prisma.issue.findMany({
      where: {
        tenantId: vendorOrgId,
        supportCustomerUserId: { not: null },
        slaBreachedAt: null,
        firstRespondedAt: null,
        firstResponseDueAt: { lt: now },
        deletedAt: null,
        // Открытый тикет: статус не закрыт/не отменён (или статус не задан).
        OR: [
          { stateId: null },
          { state: { category: { notIn: ['completed', 'cancelled'] } } },
        ],
      },
      select: { id: true },
    });
    if (overdue.length === 0) return 0;

    const res = await this.prisma.issue.updateMany({
      where: { id: { in: overdue.map((i) => i.id) } },
      data: { slaBreachedAt: now },
    });
    return res.count;
  }
}
