/**
 * InvoiceNumberService — формирование строкового invoiceNumber.
 *
 * Формат: `Z-YYYY-NNNNNN` где
 *   - `YYYY` — год создания инвойса (UTC).
 *   - `NNNNNN` — `billingNumber` из БД (autoincrement Int), padded до 6 цифр.
 *     При переполнении (>= 1_000_000 счетов в год) — padding расширяется
 *     естественно, формат остаётся валидным.
 *
 * Не зависит от БД — `billingNumber` подаётся снаружи (он autoincrement
 * Prisma sequence). Pure-функция, легко тестируется.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §6 + §19.2.
 */

import { Injectable } from '@nestjs/common';

/** Префикс — фиксированный «Z» (под ребрендом Z → Кора оставляем латиницу
 *  для упрощения парсинга банком при безналичной оплате). */
export const INVOICE_PREFIX = 'Z';
/** Минимальная ширина numeric-части (с padding нулями). */
export const INVOICE_NUMBER_PADDING = 6;

@Injectable()
export class InvoiceNumberService {
  /** Сформировать строковый номер `Z-2026-000123`. */
  format(billingNumber: number, createdAt: Date = new Date()): string {
    if (!Number.isInteger(billingNumber) || billingNumber <= 0) {
      throw new Error(
        `InvoiceNumberService.format: billingNumber должен быть положительным целым (получено ${billingNumber})`,
      );
    }
    const year = createdAt.getUTCFullYear();
    const padded = String(billingNumber).padStart(INVOICE_NUMBER_PADDING, '0');
    return `${INVOICE_PREFIX}-${year}-${padded}`;
  }
}
