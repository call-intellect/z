/**
 * BillingOverviewService — агрегированные метрики для /admin/billing-overview.
 *
 * MRR (Monthly Recurring Revenue) — сумма ежемесячных платежей всех ACTIVE-
 * подписок в paymentMode='paid'. Yearly-подписки нормализуются к месяцу
 * (totalKopecks / 12).
 *
 * ARR (Annual Recurring Revenue) = MRR × 12. Не учитывает churn/expansion —
 * это «снимок дохода в моменте».
 *
 * Считается всё в реальном времени (без materialized view). При ~1000 ACTIVE
 * Org это даёт <50мс по индексу `idx_status` на Subscription.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.4 + §14 Фаза 9.
 */

import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface BillingOverviewView {
  /** Дата снимка. */
  asOf: string;

  /** Subscription по статусам. */
  subscriptions: {
    active: number;
    activePaid: number;
    activeBonus: number;
    pastDue: number;
    suspended: number;
    canceled: number;
    expired: number;
    demo: number;
    total: number;
  };

  /** Денежные метрики (в копейках). */
  revenue: {
    mrrKopecks: number;
    arrKopecks: number;
    /** Общая сумма paid-инвойсов за всё время. */
    totalPaidKopecks: number;
    /** Сумма paid-инвойсов за текущий календарный месяц UTC. */
    currentMonthPaidKopecks: number;
  };

  /** Реферальные метрики. */
  referrals: {
    totalActivePartners: number;
    payoutsPending: number;
    payoutsPendingKopecks: number;
    payoutsPaidThisMonth: number;
    payoutsPaidThisMonthKopecks: number;
  };

  /** Инвойсы. */
  invoices: {
    totalIssued: number;
    totalPaid: number;
    totalVoid: number;
    paidThisMonth: number;
  };
}

@Injectable()
export class BillingOverviewService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOverview(): Promise<BillingOverviewView> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const [
      activeCount,
      activePaidCount,
      activeBonusCount,
      pastDueCount,
      suspendedCount,
      canceledCount,
      expiredCount,
      demoCount,
      activeSubscriptions,
      totalPaidAgg,
      thisMonthPaidAgg,
      invoiceStatusCounts,
      paidThisMonthCount,
      activePartnersCount,
      payoutsPendingAgg,
      payoutsPaidThisMonthAgg,
    ] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE', paymentMode: 'paid' },
      }),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE', paymentMode: 'bonus' },
      }),
      this.prisma.subscription.count({ where: { status: 'PAST_DUE' } }),
      this.prisma.subscription.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.subscription.count({ where: { status: 'CANCELED' } }),
      this.prisma.subscription.count({ where: { status: 'EXPIRED' } }),
      this.prisma.subscription.count({ where: { status: 'DEMO' } }),

      // Для расчёта MRR — все ACTIVE/paid подписки с их месячной ценой
      // (yearly уже нормализована в `monthlyPriceKopecks` при активации).
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', paymentMode: 'paid' },
        select: { monthlyPriceKopecks: true },
      }),

      // Сумма всех paid-инвойсов за всё время.
      this.prisma.invoice.aggregate({
        where: { status: 'paid' },
        _sum: { totalKopecks: true },
      }),

      // Сумма paid-инвойсов за текущий календарный месяц UTC.
      this.prisma.invoice.aggregate({
        where: {
          status: 'paid',
          paidAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { totalKopecks: true },
      }),

      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: true,
      }),

      this.prisma.invoice.count({
        where: {
          status: 'paid',
          paidAt: { gte: monthStart, lt: monthEnd },
        },
      }),

      this.prisma.referral.count({}),

      this.prisma.referralPayout.aggregate({
        where: { status: 'pending' },
        _sum: { amountKopecks: true },
        _count: true,
      }),

      this.prisma.referralPayout.aggregate({
        where: { status: 'paid', periodMonth },
        _sum: { amountKopecks: true },
        _count: true,
      }),
    ]);

    const total =
      activeCount +
      pastDueCount +
      suspendedCount +
      canceledCount +
      expiredCount +
      demoCount;

    const mrrKopecks = activeSubscriptions.reduce(
      (sum, s) => sum + s.monthlyPriceKopecks,
      0,
    );
    const arrKopecks = mrrKopecks * 12;

    const invoiceByStatus: Record<string, number> = {};
    for (const row of invoiceStatusCounts) {
      invoiceByStatus[row.status] = row._count;
    }

    return {
      asOf: now.toISOString(),
      subscriptions: {
        active: activeCount,
        activePaid: activePaidCount,
        activeBonus: activeBonusCount,
        pastDue: pastDueCount,
        suspended: suspendedCount,
        canceled: canceledCount,
        expired: expiredCount,
        demo: demoCount,
        total,
      },
      revenue: {
        mrrKopecks,
        arrKopecks,
        totalPaidKopecks: totalPaidAgg._sum.totalKopecks ?? 0,
        currentMonthPaidKopecks: thisMonthPaidAgg._sum.totalKopecks ?? 0,
      },
      referrals: {
        totalActivePartners: activePartnersCount,
        payoutsPending: payoutsPendingAgg._count,
        payoutsPendingKopecks: payoutsPendingAgg._sum.amountKopecks ?? 0,
        payoutsPaidThisMonth: payoutsPaidThisMonthAgg._count,
        payoutsPaidThisMonthKopecks:
          payoutsPaidThisMonthAgg._sum.amountKopecks ?? 0,
      },
      invoices: {
        totalIssued: invoiceByStatus.issued ?? 0,
        totalPaid: invoiceByStatus.paid ?? 0,
        totalVoid: invoiceByStatus.void ?? 0,
        paidThisMonth: paidThisMonthCount,
      },
    };
  }
}
