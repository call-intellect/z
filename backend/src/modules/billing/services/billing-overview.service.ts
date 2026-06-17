import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface BillingOverviewView {
  asOf: string;

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

  revenue: {
    mrrKopecks: number;
    arrKopecks: number;
    totalPaidKopecks: number;
    currentMonthPaidKopecks: number;
  };

  referrals: {
    totalActivePartners: number;
    payoutsPending: number;
    payoutsPendingKopecks: number;
    payoutsPaidThisMonth: number;
    payoutsPaidThisMonthKopecks: number;
  };

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
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
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
      this.prisma.subscription.count({
        where: {
          status: 'ACTIVE',
          paymentMode: { in: ['paid', 'bonus'] },
        },
      }),
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

      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', paymentMode: 'paid' },
        select: { monthlyPriceKopecks: true },
      }),

      this.prisma.invoice.aggregate({
        where: { status: 'paid' },
        _sum: { totalKopecks: true },
      }),

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
      activeCount + pastDueCount + suspendedCount + canceledCount + expiredCount + demoCount;

    const mrrKopecks = activeSubscriptions.reduce((sum, s) => sum + s.monthlyPriceKopecks, 0);
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
        payoutsPaidThisMonthKopecks: payoutsPaidThisMonthAgg._sum.amountKopecks ?? 0,
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
