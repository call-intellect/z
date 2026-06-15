/**
 * ReferralsService — CRUD реферального профиля.
 *
 * Бизнес-правила:
 *   - Один user → один Referral (`@unique ownerUserId`).
 *   - Slug: 8 chars из nanoid с custom alphabet (a-z, 0-9; без 0/o/l/1 чтобы
 *     не путались в QR-кодах и копировании руками).
 *   - Создание профиля: достаточно `contractAccepted: true`. Реквизиты
 *     (`inn / legalForm / payoutDetails`) можно заполнить позже (ТЗ
 *     2026-05-31-referrals-cabinet-revamp §6.1).
 *   - ИНН верифицируется через `InnLookupService.lookup(inn)` — отдельный
 *     метод `verifyInn()`, который ставит `innVerifiedAt = now` если lookup
 *     успешен (без сравнения с владельцем — на MVP доверяем юзеру).
 *   - Контракт-оферта: `acceptContract()` ставит `contractAcceptedAt = now`
 *     (legacy-эндпоинт; в новом флоу оферта принимается при `create`).
 *     Без `innVerifiedAt && contractAcceptedAt && payoutDetails` cron
 *     10-го числа НЕ переведёт payout в `paid` (см. ReferralPayoutCron).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §9
 * и plans/tz/2026-05-31-referrals-cabinet-revamp.md §6, §7.
 */

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
import {
  Prisma,
  type Referral,
  type ReferralLegalForm,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SeatService } from '../../billing/services/seat.service';
import { InnLookupService } from '../../inn-lookup/inn-lookup.service';
import type { FunnelPeriod } from '../dto/referrals.dto';

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 8;
const generateSlug = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

/** ТЗ referrals-cabinet-revamp §7.2: фиксированная сумма комиссии. */
const REFERRAL_COMMISSION_KOPECKS = 2_000_000;

/**
 * Создание партнёрского профиля (ТЗ referrals-cabinet-revamp §7.2).
 *
 * `contractAccepted` обязателен на сервисном уровне (дополнительный
 * defense-in-depth — даже если контроллер вызвал create напрямую без Zod).
 * Если задан `inn` — обязателен `legalForm` (и наоборот) — иначе
 * `BadRequestException`.
 */
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

/**
 * Маскированный клиент партнёра (ТЗ referrals-cabinet-revamp §6.4).
 *
 * **Юридический приоритет:** ни одно поле не должно идентифицировать Org.
 */
export interface ReferralClientMaskedView {
  clientCode: string;
  attachedAt: Date;
  firstPaidAt: Date | null;
  status: 'active' | 'churned' | 'pending';
  monthlyEarningsKopecks: number;
  totalEarnedKopecks: number;
}

/** Расширенная статистика партнёра (ТЗ referrals-cabinet-revamp §7.2). */
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

/** Точка графика дохода (ТЗ referrals-cabinet-revamp §7.3). */
export interface MonthlyPoint {
  month: string; // 'YYYY-MM'
  incomeRub: number;
  activeClients: number;
}

/**
 * Прогресс к награде партнёра (B2 — шкала прогресса баннера рефералки).
 * `hasProfile=false` для pre-profile-кейса (профиль ещё не создан).
 */
export interface RewardProgress {
  hasProfile: boolean;
  activePaying: number;
  targetClients: number;
  monthlyEarnedKopecks: number;
}

/** Воронка (ТЗ referrals-cabinet-revamp §7.3). */
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

  /**
   * Создать реферальный профиль (ТЗ referrals-cabinet-revamp §6.1, §7.2).
   *
   * - Обязательно `contractAccepted === true` (иначе BadRequest).
   * - `inn` и `legalForm` идут парой: либо оба, либо ни одного (иначе BadRequest).
   * - `contractAcceptedAt = now()` ставится сразу (согласие == принятие).
   * - `verifyInn` НЕ вызывается автоматически — это явное действие из UI.
   */
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
        payoutDetails:
          input.payoutDetails !== undefined
            ? input.payoutDetails
            : Prisma.JsonNull,
        contractAcceptedAt: new Date(),
      },
    });
  }

  /**
   * Обновить inn / legalForm / payoutDetails (сбрасывает innVerifiedAt если inn менялся).
   *
   * null-safe сравнение: `existing.inn` теперь nullable (ТЗ §5.1).
   */
  async update(
    ownerUserId: string,
    input: UpdateReferralInput,
  ): Promise<Referral> {
    const existing = await this.getByUserId(ownerUserId);
    if (!existing) {
      throw new NotFoundException(
        `Партнёрский профиль для user ${ownerUserId} не найден`,
      );
    }
    const data: Prisma.ReferralUncheckedUpdateInput = {};
    if (input.inn !== undefined && input.inn.trim() !== (existing.inn ?? '')) {
      data.inn = input.inn.trim();
      data.innVerifiedAt = null; // сброс верификации при смене ИНН
    }
    if (input.legalForm !== undefined) data.legalForm = input.legalForm;
    if (input.payoutDetails !== undefined) data.payoutDetails = input.payoutDetails;
    return this.prisma.referral.update({
      where: { id: existing.id },
      data,
    });
  }

  /**
   * Верифицировать ИНН реферала через InnLookupService.
   *
   * audit Б6 (2026-05-29): раньше любой lookup-успех ставил innVerifiedAt.
   * Можно было подать ИНН любого юрлица и получить отметку. Теперь:
   *   - **self_employed / individual**: ИНН в lookup-результате должен
   *     БУКВАЛЬНО совпадать с введённым (защита от опечатки/подмены).
   *     На практике для физлица lookup возвращает свой же ИНН — значит
   *     verifyInn автоматически проходит, если ИНН валидный.
   *   - **company**: требуется `directorName` в lookup-результате и
   *     совпадение по фамилии с `User.name` заявителя. Если нет — статус
   *     `pendingDocVerification` (innVerifiedAt НЕ ставится), UI попросит
   *     загрузить документ.
   *   - На несовпадении бьём метрику `referral_inn_mismatch_total`.
   */
  async verifyInn(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(
        `Партнёрский профиль для user ${ownerUserId} не найден`,
      );
    }
    // ТЗ referrals-cabinet-revamp §5.1: inn теперь optional. Если ИНН ещё не
    // задан — нечего верифицировать, возвращаем профиль как есть (не throw'им,
    // потому что вызов verifyInn для неинициализированного профиля — частый
    // случай в новом флоу: пользователь жмёт «Проверить ИНН» в карточке
    // реквизитов, заполняет форму, повторно жмёт). До заполнения мы просто
    // отдаём текущее состояние без побочных эффектов.
    if (!ref.inn) return ref;
    if (ref.innVerifiedAt) return ref;

    const innValue = ref.inn;

    try {
      const lookup = await this.innLookup.lookup(innValue);
      this.logger.log(
        `Inn-lookup для ${innValue} → ${lookup.source}/${lookup.payerType}`,
      );

      // audit Б6: проверки до выставления innVerifiedAt.
      if (lookup.inn && lookup.inn.replace(/\D/g, '') !== innValue.replace(/\D/g, '')) {
        this.logger.warn(
          `verifyInn: ИНН в lookup-результате (${lookup.inn}) не совпадает с введённым (${innValue})`,
        );
        this.metrics.incReferralInnMismatch({ reason: 'lookup_inn_mismatch' });
        return ref;
      }

      // Для company требуем директора с совпадением по User.name.
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
      // НЕ throw — возвращаем неверифицированный профиль; UI покажет статус.
      return ref;
    }
  }

  /**
   * Принять оферту (фикс `contractAcceptedAt`). Идемпотентно.
   *
   * Legacy-эндпоинт (ТЗ referrals-cabinet-revamp §7.2): в новом флоу оферта
   * принимается при `create` через `contractAccepted: true`. Метод оставлен
   * для обратной совместимости с уже существующими профилями, у которых
   * `contractAcceptedAt == null`.
   */
  async acceptContract(ownerUserId: string): Promise<Referral> {
    const ref = await this.getByUserId(ownerUserId);
    if (!ref) {
      throw new NotFoundException(
        `Партнёрский профиль для user ${ownerUserId} не найден`,
      );
    }
    if (ref.contractAcceptedAt) return ref;
    return this.prisma.referral.update({
      where: { id: ref.id },
      data: { contractAcceptedAt: new Date() },
    });
  }

  /**
   * Список приведённых клиентов в маскированном виде (ТЗ §6.4).
   *
   * **Юридический приоритет:** возвращаем только анонимный `clientCode`,
   * даты и агрегированные суммы. Никаких `org.id`, `org.name`, `tenantId`,
   * ИНН клиента — это даёт партнёру возможность увести клиента мимо нас.
   *
   * `include.subscription` нужен ТОЛЬКО для расчёта `status` ('active' /
   * 'churned' / 'pending') — поля `status` и `paymentMode` не попадают в
   * выходной DTO напрямую. `include.org` НЕ используется (намеренно убран).
   */
  async listClients(referralId: string): Promise<ReferralClientMaskedView[]> {
    const links = await this.prisma.clientReferralLink.findMany({
      where: { referralId },
      include: {
        // Нужно только для расчёта 'active'/'churned' — в response не попадает.
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

    // Подтянем payouts всех link'ов разом (1 запрос вместо N).
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

  /**
   * Список приведённых клиентов для super_admin (БЕЗ маскировки).
   *
   * Используется только в `AdminReferralsController.detail()` — super_admin
   * имеет право видеть реальные `org.name`/`org.id` для аудита и поддержки.
   * Контракт маскировки из §6.4 относится исключительно к партнёру (`/api/v1/referrals/me/clients`).
   */
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

  /** Список payout'ов реферала. */
  async listPayouts(referralId: string) {
    return this.prisma.referralPayout.findMany({
      where: { referralId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Расширенная статистика партнёра (ТЗ §6.3 + §7.2).
   *
   * Legacy 5 полей + 5 новых (clicks30d / signups30d / firstPayments30d
   * + 2 конверсии). Все count'ы параллельно через Promise.all.
   */
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

  /**
   * Прогресс к награде партнёра для шкалы промо-баннера (B2).
   *
   * Покрывает pre-profile-кейс: если профиля нет — возвращаем
   * `{ hasProfile: false, activePaying: 0, monthlyEarnedKopecks: 0 }`, но
   * `targetClients` всё равно посчитан (шкала рисуется с нулевым прогрессом),
   * НЕ возвращаем null.
   *
   * `targetClients = ceil(baseMonthlyPriceKopecks / REFERRAL_COMMISSION_KOPECKS)` —
   * сколько активных клиентов «отбивают» базовую месячную подписку. Базовую
   * цену берём из `SeatService.calculateMonthlyPriceKopecks(0)` (эффективная
   * `billing.baseMonthlyKopecks` из AdminSetting через `getDynamic`, не
   * хардкод) — формула самонастраивается при смене цены.
   */
  async getRewardProgress(ownerUserId: string): Promise<RewardProgress> {
    const baseMonthlyPriceKopecks = await this.seats.calculateMonthlyPriceKopecks(0);
    const targetClients = Math.ceil(
      baseMonthlyPriceKopecks / REFERRAL_COMMISSION_KOPECKS,
    );

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

  /**
   * График дохода и активных клиентов по месяцам (ТЗ §7.3).
   *
   * Ровно 12 точек: `now - 11mo` … `now` включительно (UTC, начало месяца).
   * Алгоритм:
   *   1. Берём payouts (status in pending|paid) за окно 12 месяцев. Группируем
   *      в коде по `periodMonth` ('YYYY-MM'). Считаем в коде, а не raw SQL
   *      `GROUP BY` — выборка маленькая (≤ N клиентов × 12 месяцев), а
   *      переход на raw SQL ломает совместимость с in-memory тестами.
   *   2. Берём все ClientReferralLink партнёра — для каждого месяца
   *      считаем «сколько было активных на конец месяца» (firstPaidAt
   *      <= конец месяца). На MVP не учитываем churn по месяцам (отдельной
   *      колонки `churnedAt` нет) — для текущего месяца берём live
   *      `subscription.status='ACTIVE' && paymentMode='paid'`.
   */
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
      incomeByMonth.set(
        p.periodMonth,
        (incomeByMonth.get(p.periodMonth) ?? 0) + p.amountKopecks,
      );
    }

    const points: MonthlyPoint[] = months.map(({ key, endExclusive }) => {
      // Активные на конец месяца: firstPaidAt < endExclusive.
      // Для исторических месяцев это «когда-либо стал активным к этой дате»,
      // для текущего — пересекается с live ACTIVE+paid (точнее: link стал
      // активным до сейчас И сейчас платит).
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

  /**
   * Воронка партнёра за период (ТЗ §7.3).
   *
   * Для `'all'` — без фильтра по датам (clicks/signups/firstPayments за всё
   * время). Для `'30d'` / `'90d'` — фильтр `>= now - N дней`. `activeNow`
   * — снимок «сейчас» (как `getStats.activePaying`), не зависит от периода.
   */
  async getFunnel(referralId: string, period: FunnelPeriod): Promise<Funnel> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { slug: true },
    });
    const slug = referral?.slug ?? null;

    const since: Date | null =
      period === 'all' ? null : daysAgo(period === '30d' ? 30 : 90);
    const dateGte = since ? { gte: since } : undefined;

    const [clicks, signupsFromLinks, signupsFromOrgs, firstPayments, activeNow] =
      await Promise.all([
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
          where: { referralId, ...(dateGte ? { firstPaidAt: dateGte } : { firstPaidAt: { not: null } }) },
        }),
        this.prisma.clientReferralLink.count({
          where: {
            referralId,
            firstPaidAt: { not: null },
            subscription: { status: 'ACTIVE', paymentMode: 'paid' },
          },
        }),
      ]);

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

  /**
   * Активна ли кнопка «Вывести» для этого профиля (ТЗ §6.5).
   *
   * Хелпер не используется текущим контроллером (фронт строит логику сам
   * по `stats` и `view`), но экспортируется для возможного эндпоинта
   * `/me/withdraw-eligibility` на будущих фазах.
   */
  static computeWithdrawalEligibility(ref: Referral, totalPendingKopecks: number): {
    eligible: boolean;
    reason: 'ok' | 'no_payout_details' | 'no_inn_verified' | 'no_balance';
  } {
    if (!hasPayoutDetails(ref)) return { eligible: false, reason: 'no_payout_details' };
    if (!ref.innVerifiedAt) return { eligible: false, reason: 'no_inn_verified' };
    if (totalPendingKopecks <= 0) return { eligible: false, reason: 'no_balance' };
    return { eligible: true, reason: 'ok' };
  }

  // ────────────────────────── private ──────────────────────────

  // ↓ см. ниже extractLastName в file scope

  /** Генерация уникального slug'а. Retry до 5 раз при коллизии. */
  private async generateUniqueSlug(): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = generateSlug();
      const taken = await this.prisma.referral.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Крайне маловероятно (32^8 ≈ 1.1×10^12 комбинаций). Fallback на hex.
    return randomBytes(6).toString('hex');
  }
}

/** Сколько копеек 20 000 ₽ комиссии — экспортируем для тестов / возможных утилит. */
export const REFERRAL_MONTHLY_COMMISSION_KOPECKS = REFERRAL_COMMISSION_KOPECKS;

/**
 * audit Б6: грубое извлечение фамилии для сравнения «director vs user».
 * Принимаем «Иванов Иван Иванович» / «Иван Иванов» / «И. И. Иванов». Берём
 * самое длинное русское слово в верхнем регистре первой буквы, либо первое
 * слово >2 символов. Если ничего не нашли — возвращаем null.
 */
function extractLastName(fullName: string | null): string | null {
  if (!fullName) return null;
  const tokens = fullName
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && /^[\p{L}-]+$/u.test(t));
  if (tokens.length === 0) return null;
  // Берём самое длинное слово как эвристику «фамилии». Для «Иванов Иван Иванович»
  // это часто «Иванов» либо «Иванович» — оба содержат «Иванов».
  let best = tokens[0]!;
  for (const t of tokens) {
    if (t.length > best.length) best = t;
  }
  return best.toLowerCase();
}

// ──────────────────────── helpers (file scope) ────────────────────────

/**
 * Анонимный идентификатор клиента партнёра (ТЗ §6.4 + §7.4).
 *
 * `'C' + base36(crc32(linkId))` — детерминированный, ~7 символов, без
 * хранения в БД. `crc32` из `node:zlib` доступен в Node 20+ и в Bun.
 * Коллизия (4.3 млрд значений на ~max-base36 7 символов) для одного
 * партнёра практически невозможна — массовая реф-программа не дойдёт до
 * единиц миллионов клиентов на одного человека.
 */
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

/**
 * Признак «банковские реквизиты для выплаты заполнены» — `payoutDetails`
 * содержит непустой JSON-объект.
 *
 * Используется как:
 *   - часть `computeWithdrawalEligibility` (правило «no_payout_details»);
 *   - computed-поле `hasPayoutDetails` в `ReferralViewBody` (фронт строит
 *     по нему `canWithdraw`, заменив прежнюю эвристику по `inn && legalForm`).
 *
 * См. ТЗ referrals-cabinet-revamp §6.3 + §6.5 и
 * `plans/tz/2026-05-31-referrals-cabinet-revamp.md` блок «hasPayoutDetails».
 */
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
  key: string; // 'YYYY-MM'
  start: Date; // 1-е число месяца, UTC
  endExclusive: Date; // 1-е число следующего месяца, UTC
}

/** Массив 12 месяцев: `now - 11mo` … `now` включительно (UTC). */
function buildLast12Months(now: Date): MonthSlot[] {
  const slots: MonthSlot[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const base = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    const next = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1),
    );
    const y = base.getUTCFullYear();
    const m = String(base.getUTCMonth() + 1).padStart(2, '0');
    slots.push({ key: `${y}-${m}`, start: base, endExclusive: next });
  }
  return slots;
}
