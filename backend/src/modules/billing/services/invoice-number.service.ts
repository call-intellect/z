import { Injectable } from '@nestjs/common';

export const INVOICE_PREFIX = 'Z';
export const INVOICE_NUMBER_PADDING = 6;

@Injectable()
export class InvoiceNumberService {
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
