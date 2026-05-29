/**
 * ReferralPayoutService — начисление реф-комиссии при invoice.paid + cron 10-го.
 *
 * Поток (ТЗ §9):
 *   1. Подписан на `billing.invoice.paid` (через @OnEvent).
 *   2. При paymentMode='paid' и существующем ClientReferralLink → создаёт
 *      ReferralPayout(amountKopecks=2 000 000, status=pending,
 *      periodMonth=YYYY-MM из paidAt).
 *   3. Если ClientReferralLink ещё нет — резолвит pending-атрибуцию через
 *      AttributionService.resolvePendingForOrg → создаёт ClientReferralLink
 *      с firstPaidAt=now + Payout → очищает Org.pendingAttribution*.
 *   4. При paymentMode='bonus' — НЕ создаёт payout (Б6, реф НЕ идёт).
 *
 * Cron `0 10 10 * *` Europe/Moscow:
 *   - Все pending-payout'ы прошлого месяца переводятся в `paid` только если
 *     реферал верифицирован (innVerifiedAt) и принял оферту (contractAcceptedAt).
 *     Остальные → `void` с voidReason='referral_not_verified'.
 *   - Реальная выплата делается админом руками через банковский интерфейс;
 *     cron только закрывает периоды и отмечает payouts для аудита.
 *
 * Идемпотентность:
 *   - Проверка `existing payout по triggerInvoiceId` перед create — повторный
 *     emit invoice.paid (например через retry) не задвоит начисление.
 *   - Cron работает по filter status='pending', повторный запуск ничего не меняет.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §9 + §14 Фаза 6.
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import {
  Prisma,
  type ReferralPayout,
  type ReferralPayoutStatus,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  BillingEvent,
  type InvoicePaidPayload,
} from '../../billing/events/billing.events';

import { AttributionService } from './attribution.service';

/** Фиксированная сумма комиссии: 20 000 ₽ × 100. */
export const REFERRAL_COMMISSION_KOPECKS = 2_000_000;

const PAYOUT_CRON_LOCK_KEY = 'referral:payout-cron:lock';
const PAYOUT_CRON_LOCK_TTL_SECONDS = 1800; // 30 минут

@Injectable()
export class ReferralPayoutService {
  private readonly logger = new Logger(ReferralPayoutService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
  ) {}

  /**
   * Hook на оплату инвойса. Создаёт ReferralPayout если есть атрибуция и
   * paymentMode='paid'. Fire-and-forget (ошибки логируются, не бьют каллера).
   */
  @OnEvent(BillingEvent.INVOICE_PAID, { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload): Promise<void> {
    try {
      if (payload.paymentMode !== 'paid') {
        return; // bonus — реф НЕ идёт (Б6)
      }
      if (!payload.subscriptionId) {
        return; // адхок-инвойсы без подписки — не реф-кейс
      }

      const sub = await this.prisma.subscription.findUnique({
        where: { id: payload.subscriptionId },
        include: { clientReferralLink: true },
      });
      if (!sub) return;

      // audit Б7 (2026-05-29): атомарную защиту от двойного payout даёт
      // unique-индекс ReferralPayout.triggerInvoiceId. Здесь мы НЕ делаем
      // findFirst+create (TOCTOU при параллельных onInvoicePaid-обработчиках).
      // Если параллельный вызов уже создал payout — наш create поймает P2002,
      // catch ниже превратит это в idempotent skip.
      let clientLink = sub.clientReferralLink;

      // Если линка ещё нет — пытаемся резолвить pending-атрибуцию Org.
      if (!clientLink) {
        const pending = await this.attribution.resolvePendingForOrg(payload.tenantId);
        if (!pending) {
          this.logger.log(
            `invoice.paid: no pending attribution for org=${payload.tenantId} — skip`,
          );
          return;
        }
        clientLink = await this.prisma.clientReferralLink.create({
          data: {
            tenantId: payload.tenantId,
            referralId: pending.referralId,
            subscriptionId: sub.id,
            firstPaidAt: new Date(),
          },
        });
        await this.attribution.clearPendingForOrg(payload.tenantId);
        this.logger.log(
          `First-touch ClientReferralLink создан (org=${payload.tenantId}, referral=${pending.referralId})`,
        );
      } else if (!clientLink.firstPaidAt) {
        // Уже есть link, но без firstPaidAt — это аномалия (link создавался
        // при втором сценарии: при manual-activate когда атрибуция была).
        // Проставляем сейчас.
        clientLink = await this.prisma.clientReferralLink.update({
          where: { id: clientLink.id },
          data: { firstPaidAt: new Date() },
        });
      }

      const periodMonth = this.formatPeriodMonth(payload.paidAt);
      try {
        await this.prisma.referralPayout.create({
          data: {
            referralId: clientLink.referralId,
            clientReferralLinkId: clientLink.id,
            triggerInvoiceId: payload.invoiceId,
            periodMonth,
            amountKopecks: REFERRAL_COMMISSION_KOPECKS,
            status: 'pending',
          },
        });
        this.logger.log(
          `ReferralPayout pending создан: ${REFERRAL_COMMISSION_KOPECKS}коп для referral=${clientLink.referralId} period=${periodMonth}`,
        );
      } catch (createErr) {
        // audit Б7: P2002 на triggerInvoiceId — параллельный вызов уже создал
        // payout. Это нормально, не ошибка.
        if (
          createErr instanceof Prisma.PrismaClientKnownRequestError &&
          createErr.code === 'P2002'
        ) {
          this.logger.log(
            `ReferralPayout для invoice=${payload.invoiceId} уже существует (P2002) — skip (idempotent)`,
          );
          return;
        }
        throw createErr;
      }
    } catch (err) {
      this.logger.error(
        `onInvoicePaid failed for invoice=${payload.invoiceId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Cron 10-го числа в 10:00 МСК — финализация payout'ов прошлого месяца.
   *
   * Логика:
   *   - Для верифицированных рефералов (innVerifiedAt + contractAcceptedAt) —
   *     status='paid' + paidAt=now (фактический перевод делает админ руками,
   *     это закрытие периода в нашей БД).
   *   - Для не-верифицированных — status='void' + voidReason='referral_not_verified'.
   */
  @Cron('0 10 10 * *', { timeZone: 'Europe/Moscow' })
  async runMonthlyClose(): Promise<void> {
    const acquired = await this.redis.client.set(
      PAYOUT_CRON_LOCK_KEY,
      Date.now().toString(),
      'EX',
      PAYOUT_CRON_LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.warn(
        `ReferralPayoutCron: лок занят — пропускаем`,
      );
      return;
    }

    try {
      const now = new Date();
      const periodMonth = this.formatPeriodMonth(this.previousMonth(now));
      await this.closePeriod(periodMonth);
    } finally {
      await this.redis.client.del(PAYOUT_CRON_LOCK_KEY).catch(() => {});
    }
  }

  /**
   * Закрыть период вручную (admin-эндпоинт + cron). Идемпотентно.
   */
  async closePeriod(periodMonth: string): Promise<{
    paid: number;
    voided: number;
    skipped: number;
  }> {
    const pending = await this.prisma.referralPayout.findMany({
      where: { periodMonth, status: 'pending' },
      include: {
        referral: {
          select: {
            id: true,
            innVerifiedAt: true,
            contractAcceptedAt: true,
            slug: true,
          },
        },
      },
    });

    let paid = 0;
    let voided = 0;
    let skipped = 0;
    const now = new Date();

    for (const payout of pending) {
      const verified =
        payout.referral.innVerifiedAt && payout.referral.contractAcceptedAt;
      if (!verified) {
        await this.prisma.referralPayout.update({
          where: { id: payout.id },
          data: {
            status: 'void',
            voidReason: 'referral_not_verified',
          },
        });
        voided += 1;
        continue;
      }
      try {
        await this.prisma.referralPayout.update({
          where: { id: payout.id },
          data: {
            status: 'paid',
            paidAt: now,
          },
        });
        paid += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `closePeriod payout=${payout.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `closePeriod ${periodMonth}: paid=${paid} voided=${voided} skipped=${skipped}`,
    );
    return { paid, voided, skipped };
  }

  /**
   * Admin: пометить конкретный payout как paid (с привязкой акта/чека НПД).
   */
  async markPaidByAdmin(args: {
    payoutId: string;
    payoutDocumentUrl?: string | null;
  }): Promise<ReferralPayout> {
    const payout = await this.prisma.referralPayout.findUnique({
      where: { id: args.payoutId },
    });
    if (!payout) {
      throw new NotFoundException(`ReferralPayout ${args.payoutId} не найден`);
    }
    if (payout.status === 'paid') return payout;
    if (payout.status === 'void') {
      throw new Error(
        `Payout ${args.payoutId} в статусе void — нельзя пометить paid`,
      );
    }
    return this.prisma.referralPayout.update({
      where: { id: payout.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        payoutDocumentUrl: args.payoutDocumentUrl ?? payout.payoutDocumentUrl,
      },
    });
  }

  /** Admin: аннулировать payout с reason'ом. */
  async voidByAdmin(args: {
    payoutId: string;
    voidReason: string;
  }): Promise<ReferralPayout> {
    const payout = await this.prisma.referralPayout.findUnique({
      where: { id: args.payoutId },
    });
    if (!payout) {
      throw new NotFoundException(`ReferralPayout ${args.payoutId} не найден`);
    }
    if (payout.status === 'void') return payout;
    return this.prisma.referralPayout.update({
      where: { id: payout.id },
      data: {
        status: 'void',
        voidReason: args.voidReason,
      },
    });
  }

  /** Список payout'ов по статусу + периоду (для админ-UI). */
  async list(args: {
    status?: ReferralPayoutStatus;
    periodMonth?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ReferralPayout[]; total: number }> {
    const where: Prisma.ReferralPayoutWhereInput = {
      ...(args.status ? { status: args.status } : {}),
      ...(args.periodMonth ? { periodMonth: args.periodMonth } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.referralPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
        include: {
          referral: { select: { slug: true, inn: true, legalForm: true } },
        },
      }),
      this.prisma.referralPayout.count({ where }),
    ]);
    return { items, total };
  }

  // ──────────────────────── private ────────────────────────

  /** Формат периодa: 'YYYY-MM' (UTC). */
  private formatPeriodMonth(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  private previousMonth(d: Date): Date {
    const result = new Date(d);
    result.setUTCMonth(result.getUTCMonth() - 1);
    return result;
  }
}
