import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type {
  BillingProviderPort,
  BankInvoiceFileResult,
  ChargeRecurringSubscriptionRequest,
  ChargeRecurringSubscriptionResult,
  CreateBankInvoiceRequest,
  CreateBankInvoiceResult,
  CreatePaymentRequest,
  CreatePaymentResult,
  CreateRecurringSubscriptionRequest,
  CreateRecurringSubscriptionResult,
  GetBankInvoiceStatusResult,
  PaymentStatusResult,
  WebhookEvent,
} from './billing-provider.port';

const UNAVAILABLE_MESSAGE =
  'Платёжный провайдер не настроен (BILLING_PROVIDER=manual). ' +
  'Доступна только ручная активация подписки администратором.';

@Injectable()
export class ManualBillingProvider implements BillingProviderPort {
  readonly providerName = 'manual' as const;
  private readonly logger = new Logger(ManualBillingProvider.name);

  async createPayment(_req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async createRecurringSubscription(
    _req: CreateRecurringSubscriptionRequest,
  ): Promise<CreateRecurringSubscriptionResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async chargeRecurringSubscription(
    _req: ChargeRecurringSubscriptionRequest,
  ): Promise<ChargeRecurringSubscriptionResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async getRecurringSubscriptionStatus(_id: string): Promise<string> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async cancelRecurringSubscription(_id: string): Promise<void> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async refundPayment(_req: { providerInvoiceId: string; amountKopecks: number }): Promise<void> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async getPaymentStatus(_id: string): Promise<PaymentStatusResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async createBankInvoice(_req: CreateBankInvoiceRequest): Promise<CreateBankInvoiceResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async getBankInvoiceStatus(_id: string): Promise<GetBankInvoiceStatusResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async sendBankInvoiceToEmail(_req: { providerInvoiceId: string; email: string }): Promise<void> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async getBankInvoiceFile(_id: string): Promise<BankInvoiceFileResult> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  async deleteBankInvoice(_id: string): Promise<void> {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }

  parseWebhook(_headers: Record<string, string>, _body: unknown): WebhookEvent {
    this.logger.warn(
      'ManualBillingProvider.parseWebhook был вызван — webhook не должен попадать сюда при manual-режиме',
    );
    return {
      eventId: 'manual:no-op',
      eventType: 'manual.no_op',
      providerInvoiceId: '',
      status: 'unknown',
      rawPayload: {},
    };
  }

  async verifyWebhookSignature(_headers: Record<string, string>, _body: unknown): Promise<boolean> {
    return false;
  }
}
