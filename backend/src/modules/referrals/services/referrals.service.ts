import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Referral, type ReferralLegalForm } from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SeatService } from '../../billing/services/seat.service';
import { InnLookupService } from '../../inn-lookup/inn-lookup.service';
import type { FunnelPeriod } from '../dto/referrals.dto';

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 8;
const generateSlug = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

const REFERRAL_COMMISSION_KOPECKS = 2_000_000;

export interface CreateReferralInput {
  ownerUserId: string;
  contractAccepted: boolean;
  inn?: string;
  legalForm?: ReferralLegalForm;
  payoutDetails?: Prisma.InputJsonValue;
}

export interface UpdateReferralInput {
  inn?: string;
  legalForm?: ReferralLegalForm;
  payoutDetails?: Prisma.InputJsonValue;
}

export interface ReferralClientMaskedView {
  clientCode: string;
  attachedAt: Date;
  firstPaidAt: Date | null;
  status: 'active' | 'churned' | 'pending';
  monthlyEarningsKopecks: number;
  totalEarnedKopecks: number;
}

export interface ReferralStatsExtended {
  totalClients: number;
  activePaying: number;
  totalEarnedKopecks: number;
  totalPaidKopecks: number;
  totalPendingKopecks: number;
  clicks30d: number;
  signups30d: number;
  firstPayments30d: number;
  conversionClickToPaidPercent: number;
  conversionSignupToPaidPercent: number;
}

export interface MonthlyPoint {
  month: string;
  incomeRub: number;
  activeClients: number;
}

export interface RewardProgress {
  hasProfile: boolean;
  activePaying: number;
  targetClients: number;
  monthlyEarnedKopecks: number;
}

export interface Funnel {
  period: FunnelPeriod;
  clicks: number;
  signups: number;
  firstPayments: number;
  activeNow: number;
  conversions: {
    clickToSignupPercent: number;
    signupToPaidPercent: number;
    clickToPaidPercent: number;
  };
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InnLookupService) private readonly innLookup: InnLookupService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(SeatService) private readonly seats: SeatService,
  ) {}

  async getByUserId(ownerUserId: string): Promise<Referral | null> {
    return this.prisma.referral.findUnique({ where: { ownerUserId } });
  }

  async getBySlug(slug: string): Promise<Referral | null> {
    return this.prisma.referral.findUnique({ where: { slug } });
  }

  async create(input: CreateReferralInput): Promise<Referral> {
    if (input.contractAccepted !== true) {
      throw new BadRequestException(
        'Создание партнёрского профиля требует принятия оферты (contractAccepted=true)',
      );
    }
    const hasInn = input.inn !== undefined && input.inn.trim() !== '';
    const hasLegalForm = input.legalForm !== undefined;
    if (hasInn !== hasLegalForm) {
      throw new BadRequestException(
        'Поля inn и legalForm должны быть указаны вместе (либо оба, либо ни одного)',
      );
    }

    const existing = await this.getByUserId(input.ownerUserId);
    if (existing) {
      throw new ConflictException(
        `Партнёрский профиль для user ${input.ownerUserId} уже существует (slug=${existing.slug})`,
      );
    }

    return this.prisma.referral.create({
      data: {
        ownerUserId: input.ownerUserId,
        slug: await this.generateUniqueSlug(),
        inn: hasInn ? input.inn!.trim() : null,
        legalForm: hasLegalForm ? input.legalForm! : null,
        payoutDetails: input.payoutDetails !== undefined ? input.payoutDetails : Prisma.JsonNull,
        contractAcceptedAt: new Date(),
      },
    });
  }

  async update(ownerUserId: string, input: UpdateReferralInput): Promise<Referral> {
    const existing = await this.getByUserId(ownerUserId);
    if (!existing) {
      throw new NotFoundException(`Партнёрский профиль для user ${ownerUserId} не найден`);
    }
    const data: Prisma.ReferralUncheckedUpdateInput = {};
    if (input.inn !== undefined && input.inn.trim() !== (existing.inn ?? '')) {
      data.inn = input.inn.trim();
      data.innVerifiedAt = null;
    }
    if (input.legalForm !== undefined) data.legalForm = input.legalForm;
    if (input.payoutDetails !== undefined) data.payoutDetails = input.payoutDetails;
    return this.prisma.referral.update({
      where: { id: existing.id },
      data,
    });
  }

  async verifyInn(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(`Партнёрский профиль для user ${ownerUserId} не найден`);
    }
    if (!ref.inn) return ref;
    if (ref.innVerifiedAt) return ref;

    const innValue = ref.inn;

    try {
      const lookup = await this.innLookup.lookup(innValue);
      this.logger.log(`Inn-lookup для ${innValue} → ${lookup.source}/${lookup.payerType}`);

      if (lookup.inn && lookup.inn.replace(/\D/g, '') !== innValue.replace(/\D/g, '')) {
        this.logger.warn(
          `verifyInn: ИНН в lookup-результате (${lookup.inn}) не совпадает с введённым (${innValue})`,
        );
        this.metrics.incReferralInnMismatch({ reason: 'lookup_inn_mismatch' });
        return ref;
      }

      if (lookup.payerType === 'legal_entity') {
        const owner = await this.prisma.user.findUnique({
          where: { id: ownerUserId },
          select: { name: true },
        });
        const ownerLastName = extractLastName(owner?.name ?? null);
        const directorLastName = extractLastName(lookup.directorName ?? null);
        if (!ownerLastName || !directorLastName || ownerLastName !== directorLastName) {
          this.logger.warn(
            `verifyInn: company-партнёр ${innValue}: directorName='${lookup.directorName ?? '-'}', userName='${owner?.name ?? '-'}' — pending doc verification`,
          );
          this.metrics.incReferralInnMismatch({ reason: 'director_name_mismatch' });
          return ref;
        }
      }

      return this.prisma.referral.update({
        where: { id: ref.id },
        data: { innVerifiedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `verifyInn ${innValue} не нашёл: ${err instanceof Error ? err.message : String(err)}`,
      );
      return ref;
    }
  }

  async acceptContract(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(`Партнёрский профиль для user ${ownerUserId} не найден`);
    }
    if (ref.contractAcceptedAt) return ref;
    return this.prisma.referral.update({
      where: { id: ref.id },
      data: { contractAcceptedAt: new Date() },
    });
  }

  async listClients(referralId: string): Promise<ReferralClientMaskedView[]> {
    const links = await this.prisma.clientReferralLink.findMany({
      where: { referralId },
      include: {
        subscription: {
          select: {
            status: true,
            paymentMode: true,
          },
        },
      },
      orderBy: { attachedAt: 'desc' },
    });

    if (links.length === 0) return [];

    const linkIds = links.map((l) => l.id);
    const monthStart = startOfCurrentMonthUtc();
    const payouts = await this.prisma.referralPayout.findMany({
      where: {
        clientReferralLinkId: { in: linkIds },
        status: { in: ['pending', 'paid'] },
      },
      select: {
        clientReferralLinkId: true,
        amountKopecks: true,
        createdAt: true,
      },
    });

    const byLink = new Map<string, { monthly: number; total: number }>();
    for (const p of payouts) {
      const slot = byLink.get(p.clientReferralLinkId) ?? { monthly: 0, total: 0 };
      slot.total += p.amountKopecks;
      if (p.createdAt >= monthStart) slot.monthly += p.amountKopecks;
      byLink.set(p.clientReferralLinkId, slot);
    }

    return links.map((link) => toMaskedClientView(link, byLink.get(link.id)));
  }

  async listClientsForAdmin(referralId: string) {
    return this.prisma.clientReferralLink.findMany({
      where: { referralId },
      include: {
        org: { select: { id: true, name: true } },
        subscription: {
          select: {
            status: true,
            paymentMode: true,
            currentPeriodEnd: true,
            totalPaidKopecks: true,
          },
        },
      },
      orderBy: { attachedAt: 'desc' },
    });
  }

  async listPayouts(referralId: string) {
    return this.prisma.referralPayout.findMany({
      where: { referralId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getStats(referralId: string): Promise<ReferralStatsExtended> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { slug: true },
    });
    const slug = referral?.slug ?? null;
    const since30d = daysAgo(30);

    const [
      totalClients,
      payouts,
      activePaying,
      clicks30d,
      signupsFromLinks,
      signupsFromOrgs,
      firstPayments30d,
    ] = await Promise.all([
      this.prisma.clientReferralLink.count({ where: { referralId } }),
      this.prisma.referralPayout.findMany({
        where: { referralId },
        select: { amountKopecks: true, status: true },
      }),
      this.prisma.clientReferralLink.count({
        where: {
          referralId,
          firstPaidAt: { not: null },
          subscription: { status: 'ACTIVE', paymentMode: 'paid' },
        },
      }),
      this.prisma.referralAttribution.count({
        where: { referralId, createdAt: { gte: since30d } },
      }),
      this.prisma.clientReferralLink.count({
        where: { referralId, attachedAt: { gte: since30d } },
      }),
      slug
        ? this.prisma.org.count({
            where: {
              pendingAttributionSlug: slug,
              pendingAttributionAt: { gte: since30d },
            },
          })
        : Promise.resolve(0),
      this.prisma.clientReferralLink.count({
        where: { referralId, firstPaidAt: { gte: since30d } },
      }),
    ]);

    let totalEarned = 0;
    let totalPaid = 0;
    let totalPending = 0;
    for (const p of payouts) {
      if (p.status === 'paid') {
        totalEarned += p.amountKopecks;
        totalPaid += p.amountKopecks;
      } else if (p.status === 'pending') {
        totalEarned += p.amountKopecks;
        totalPending += p.amountKopecks;
      }
    }

    const signups30d = signupsFromLinks + signupsFromOrgs;

    return {
      totalClients,
      activePaying,
      totalEarnedKopecks: totalEarned,
      totalPaidKopecks: totalPaid,
      totalPendingKopecks: totalPending,
      clicks30d,
      signups30d,
      firstPayments30d,
      conversionClickToPaidPercent: percent(firstPayments30d, clicks30d),
      conversionSignupToPaidPercent: percent(firstPayments30d, signups30d),
    };
  }

  async getRewardProgress(ownerUserId: string): Promise<RewardProgress> {
    const baseMonthlyPriceKopecks = await this.seats.calculateMonthlyPriceKopecks(0);
    const targetClients = Math.ceil(baseMonthlyPriceKopecks / REFERRAL_COMMISSION_KOPECKS);

    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      return {
        hasProfile: false,
        activePaying: 0,
        targetClients,
        monthlyEarnedKopecks: 0,
      };
    }

    const stats = await this.getStats(ref.id);
    return {
      hasProfile: true,
      activePaying: stats.activePaying,
      targetClients,
      monthlyEarnedKopecks: stats.activePaying * REFERRAL_COMMISSION_KOPECKS,
    };
  }

  async getIncomeChart(referralId: string): Promise<MonthlyPoint[]> {
    const months = buildLast12Months(new Date());
    const earliestMonthStart = months[0]!.start;

    const [payouts, links] = await Promise.all([
      this.prisma.referralPayout.findMany({
        where: {
          referralId,
          status: { in: ['pending', 'paid'] },
          createdAt: { gte: earliestMonthStart },
        },
        select: { periodMonth: true, amountKopecks: true },
      }),
      this.prisma.clientReferralLink.findMany({
        where: { referralId, firstPaidAt: { not: null } },
        select: {
          firstPaidAt: true,
          subscription: { select: { status: true, paymentMode: true } },
        },
      }),
    ]);

    const incomeByMonth = new Map<string, number>();
    for (const p of payouts) {
      incomeByMonth.set(p.periodMonth, (incomeByMonth.get(p.periodMonth) ?? 0) + p.amountKopecks);
    }

    const points: MonthlyPoint[] = months.map(({ key, endExclusive }) => {
      const isCurrentMonth = endExclusive.getTime() > Date.now();
      let activeClients = 0;
      for (const link of links) {
        if (!link.firstPaidAt) continue;
        if (link.firstPaidAt >= endExclusive) continue;
        if (isCurrentMonth) {
          const sub = link.subscription;
          if (!sub || sub.status !== 'ACTIVE' || sub.paymentMode !== 'paid') continue;
        }
        activeClients += 1;
      }
      const incomeKopecks = incomeByMonth.get(key) ?? 0;
      return {
        month: key,
        incomeRub: Math.round(incomeKopecks / 100),
        activeClients,
      };
    });
    return points;
  }

  async getFunnel(referralId: string, period: FunnelPeriod): Promise<Funnel> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { slug: true },
    });
    const slug = referral?.slug ?? null;

    const since: Date | null = period === 'all' ? null : daysAgo(period === '30d' ? 30 : 90);
    const dateGte = since ? { gte: since } : undefined;

    const [clicks, signupsFromLinks, signupsFromOrgs, firstPayments, activeNow] = await Promise.all(
      [
        this.prisma.referralAttribution.count({
          where: { referralId, ...(dateGte ? { createdAt: dateGte } : {}) },
        }),
        this.prisma.clientReferralLink.count({
          where: { referralId, ...(dateGte ? { attachedAt: dateGte } : {}) },
        }),
        slug
          ? this.prisma.org.count({
              where: {
                pendingAttributionSlug: slug,
                ...(dateGte ? { pendingAttributionAt: dateGte } : {}),
              },
            })
          : Promise.resolve(0),
        this.prisma.clientReferralLink.count({
          where: {
            referralId,
            ...(dateGte ? { firstPaidAt: dateGte } : { firstPaidAt: { not: null } }),
          },
        }),
        this.prisma.clientReferralLink.count({
          where: {
            referralId,
            firstPaidAt: { not: null },
            subscription: { status: 'ACTIVE', paymentMode: 'paid' },
          },
        }),
      ],
    );

    const signups = signupsFromLinks + signupsFromOrgs;

    return {
      period,
      clicks,
      signups,
      firstPayments,
      activeNow,
      conversions: {
        clickToSignupPercent: percent(signups, clicks),
        signupToPaidPercent: percent(firstPayments, signups),
        clickToPaidPercent: percent(firstPayments, clicks),
      },
    };
  }

  static computeWithdrawalEligibility(
    ref: Referral,
    totalPendingKopecks: number,
  ): {
    eligible: boolean;
    reason: 'ok' | 'no_payout_details' | 'no_inn_verified' | 'no_balance';
  } {
    if (!hasPayoutDetails(ref)) return { eligible: false, reason: 'no_payout_details' };
    if (!ref.innVerifiedAt) return { eligible: false, reason: 'no_inn_verified' };
    if (totalPendingKopecks <= 0) return { eligible: false, reason: 'no_balance' };
    return { eligible: true, reason: 'ok' };
  }

  private async generateUniqueSlug(): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = generateSlug();
      const taken = await this.prisma.referral.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return randomBytes(6).toString('hex');
  }
}

export const REFERRAL_MONTHLY_COMMISSION_KOPECKS = REFERRAL_COMMISSION_KOPECKS;

function extractLastName(fullName: string | null): string | null {
  if (!fullName) return null;
  const tokens = fullName
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && /^[\p{L}-]+$/u.test(t));
  if (tokens.length === 0) return null;
  let best = tokens[0]!;
  for (const t of tokens) {
    if (t.length > best.length) best = t;
  }
  return best.toLowerCase();
}

export function clientCodeFromLinkId(linkId: string): string {
  return `C${crc32(linkId).toString(36)}`;
}

interface MaskedLinkRow {
  id: string;
  attachedAt: Date;
  firstPaidAt: Date | null;
  subscription: { status: unknown; paymentMode: unknown } | null;
}

function toMaskedClientView(
  link: MaskedLinkRow,
  earnings: { monthly: number; total: number } | undefined,
): ReferralClientMaskedView {
  const status: ReferralClientMaskedView['status'] = (() => {
    if (!link.firstPaidAt) return 'pending';
    const sub = link.subscription;
    const isActive = sub?.status === 'ACTIVE' && sub.paymentMode === 'paid';
    return isActive ? 'active' : 'churned';
  })();
  return {
    clientCode: clientCodeFromLinkId(link.id),
    attachedAt: link.attachedAt,
    firstPaidAt: link.firstPaidAt,
    status,
    monthlyEarningsKopecks: earnings?.monthly ?? 0,
    totalEarnedKopecks: earnings?.total ?? 0,
  };
}

function isNonEmptyObject(value: Prisma.JsonValue | null): boolean {
  if (value == null) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

export function hasPayoutDetails(ref: Pick<Referral, 'payoutDetails'>): boolean {
  return isNonEmptyObject(ref.payoutDetails);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

interface MonthSlot {
  key: string;
  start: Date;
  endExclusive: Date;
}

function buildLast12Months(now: Date): MonthSlot[] {
  const slots: MonthSlot[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
    const y = base.getUTCFullYear();
    const m = String(base.getUTCMonth() + 1).padStart(2, '0');
    slots.push({ key: `${y}-${m}`, start: base, endExclusive: next });
  }
  return slots;
}
