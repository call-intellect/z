/**
 * InvoiceService — CRUD счетов + markPaid/markBonus/void.
 *
 * Ключевая идиома: Invoice создаётся БЕЗ invoiceNumber (Prisma не даёт
 * `@unique` поле без значения), поэтому `create()` идёт через двухшаговую
 * транзакцию: вставляем placeholder, читаем `billingNumber` (autoincrement),
 * формируем `Z-YYYY-NNNNNN`, обновляем. Это атомарно (одна транзакция) и
 * избегает race condition при параллельных create.
 *
 * Альтернатива: сгенерировать UUID до вставки и потом backfill — но это
 * усложняет схему. Текущий подход проще и подходит для MVP.
 *
 * Все суммы — копейки (Int).
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.1.
 */

import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  type BillingPaymentMethod,
  type Invoice,
  type InvoiceStatus,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { InvoiceItem } from '../billing.types';
import { BillingEvent, type InvoicePaidPayload, type InvoiceVoidedPayload } from '../events/billing.events';

import { InvoiceNumberService } from './invoice-number.service';

export interface CreateInvoiceInput {
  tenantId: string;
  subscriptionId: string | null;
  periodStart: Date;
  periodEnd: Date;
  items: InvoiceItem[];
  paymentMethod: BillingPaymentMethod;
  dueAt?: Date | null;
  /** Уже распарсенный bonus-режим — invoice сразу пишется со status='bonus'. */
  bonusOnCreate?: boolean;
  /** Опц. внешняя транзакция. */
  tx?: Prisma.TransactionClient;
}

export interface MarkPaidInput {
  invoiceId: string;
  // 2026-06-01 — `reference` режим эталонной демо-Org не порождает инвойсов,
  // markPaid вызывается только для платных подписок (paid/bonus). См. ТЗ
  // demo-shared-org-model §4.11 (Billing исключает reference из метрик).
  paymentMode: 'paid' | 'bonus';
  byUserId?: string | null;
  externalRef?: string | null;
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InvoiceNumberService) private readonly numbering: InvoiceNumberService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /**
   * Создать инвойс. Считает `totalKopecks` как сумму items[].totalKopecks
   * (allowing negative для скидок). Сразу формирует строковый `invoiceNumber`.
   *
   * Статус по умолчанию:
   *   - 'bonus' если `bonusOnCreate=true` (admin-активация в bonus-режиме).
   *   - 'draft' иначе. Перевод в 'issued' — отдельный шаг (issueInvoice).
   */
  async create(input: CreateInvoiceInput): Promise<Invoice> {
    if (input.items.length === 0) {
      throw new BadRequestException('Invoice не может быть пустым (items=[])');
    }
    if (input.periodEnd <= input.periodStart) {
      throw new BadRequestException(
        'Invoice.periodEnd должен быть позже periodStart',
      );
    }

    const total = input.items.reduce((acc, it) => acc + it.totalKopecks, 0);
    if (total < 0) {
      throw new BadRequestException(
        'Invoice.totalKopecks отрицательный — проверь items (скидки слишком большие)',
      );
    }

    const initialStatus: InvoiceStatus = input.bonusOnCreate ? 'bonus' : 'draft';

    return this.runInTx(input.tx, async (tx) => {
      // Шаг 1: создаём с placeholder invoiceNumber. audit В5 (2026-05-29) —
      // 16 байт crypto-random (`randomBytes(16).toString('base64url')` = 22
      // символа, ≈128 бит) делает коллизию между параллельными `create()`
      // в одну миллисекунду математически невозможной. Прежний
      // `Date.now()-Math.random()` давал ~40 бит и теоретически мог биться
      // на бёрсте инвойсов от одного nodejs-процесса.
      const placeholder = `PENDING-${randomBytes(16).toString('base64url')}`;
      const draft = await tx.invoice.create({
        data: {
          tenantId: input.tenantId,
          subscriptionId: input.subscriptionId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          items: input.items as unknown as Prisma.InputJsonValue,
          totalKopecks: total,
          status: initialStatus,
          paymentMethod: input.paymentMethod,
          dueAt: input.dueAt ?? null,
          invoiceNumber: placeholder,
        },
      });

      // Шаг 2: подставляем нормальный invoiceNumber на основе billingNumber.
      const final = await tx.invoice.update({
        where: { id: draft.id },
        data: { invoiceNumber: this.numbering.format(draft.billingNumber, draft.createdAt) },
      });

      this.logger.log(
        `Создан invoice ${final.invoiceNumber} (id=${final.id}, total=${total} коп, status=${initialStatus})`,
      );
      return final;
    });
  }

  /** Получить инвойс или 404. */
  async findOrFail(invoiceId: string): Promise<Invoice> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException(`Invoice ${invoiceId} не найден`);
    return inv;
  }

  /** Список инвойсов Org. */
  async listByTenant(args: {
    tenantId: string;
    limit?: number;
    offset?: number;
    statuses?: InvoiceStatus[];
  }): Promise<{ items: Invoice[]; total: number }> {
    const where: Prisma.InvoiceWhereInput = {
      tenantId: args.tenantId,
      ...(args.statuses && args.statuses.length > 0
        ? { status: { in: args.statuses } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Перевести invoice в `paid` (или `bonus`). Идемпотентно: повторный вызов
   * на уже paid/bonus инвойсе → возвращает текущее состояние без event'а.
   */
  async markPaid(input: MarkPaidInput, tx?: Prisma.TransactionClient): Promise<Invoice> {
    return this.runInTx(tx, async (runner) => {
      const inv = await runner.invoice.findUnique({ where: { id: input.invoiceId } });
      if (!inv) throw new NotFoundException(`Invoice ${input.invoiceId} не найден`);
      if (inv.status === 'void') {
        throw new ConflictException(
          `Invoice ${inv.invoiceNumber} отменён (void), нельзя пометить оплаченным`,
        );
      }
      // Идемпотентность: если уже paid/bonus с тем же paymentMode — no-op.
      const targetStatus: InvoiceStatus = input.paymentMode === 'paid' ? 'paid' : 'bonus';
      if (inv.status === targetStatus) {
        return inv;
      }

      const updated = await runner.invoice.update({
        where: { id: inv.id },
        data: {
          status: targetStatus,
          paidAt: new Date(),
          externalRef: input.externalRef ?? inv.externalRef,
          markedByUserId: input.byUserId ?? null,
        },
      });

      // Fire-and-forget после транзакции (если tx внешняя — emit отложен в caller).
      if (!tx) {
        const payload: InvoicePaidPayload = {
          invoiceId: updated.id,
          tenantId: updated.tenantId,
          subscriptionId: updated.subscriptionId,
          amountKopecks: updated.totalKopecks,
          paymentMode: input.paymentMode,
          paidAt: updated.paidAt ?? new Date(),
        };
        const eventName =
          input.paymentMode === 'paid' ? BillingEvent.INVOICE_PAID : BillingEvent.INVOICE_BONUS;
        void this.safeEmit(eventName, payload);
      }

      return updated;
    });
  }

  /** Отменить инвойс. Только из статусов draft/issued. */
  async void(args: { invoiceId: string; reason: string; byUserId: string }): Promise<Invoice> {
    const inv = await this.findOrFail(args.invoiceId);
    if (inv.status === 'paid' || inv.status === 'bonus') {
      throw new ForbiddenException(
        `Invoice ${inv.invoiceNumber} в статусе ${inv.status} — нельзя отменить (используйте refund)`,
      );
    }
    if (inv.status === 'void') return inv;

    const updated = await this.prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'void',
        voidedAt: new Date(),
        markedByUserId: args.byUserId,
        externalRef: args.reason,
      },
    });

    const payload: InvoiceVoidedPayload = {
      invoiceId: updated.id,
      tenantId: updated.tenantId,
      reason: args.reason,
      byUserId: args.byUserId,
    };
    void this.safeEmit(BillingEvent.INVOICE_VOIDED, payload);
    return updated;
  }

  // ────────────────────── private ──────────────────────

  private async runInTx<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (runner: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction(async (t) => fn(t));
  }

  private async safeEmit(eventName: string, payload: unknown): Promise<void> {
    try {
      await this.events.emitAsync(eventName, payload);
    } catch (err) {
      this.logger.warn(
        `BillingEvent ${eventName}: emit упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
