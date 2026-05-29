/**
 * TochkaBillingProvider — реализация BillingProviderPort для Точка Банка.
 *
 * Endpoint'ы (см. документацию Точки):
 *   - acquiring/{v}/payments              — одноразовый платёж картой/СБП
 *   - acquiring/{v}/payments/{id}         — статус платежа
 *   - acquiring/{v}/payments/{id}/refund  — возврат
 *   - acquiring/{v}/subscriptions          — создание recurring подписки
 *   - acquiring/{v}/subscriptions/{id}/charge — попытка списания
 *   - acquiring/{v}/subscriptions/{id}/status — статус / отмена
 *   - invoice/{v}/bills                   — выставление безналичного счёта
 *   - invoice/{v}/bills/{cc}/{id}/...     — статус/email/файл/удаление
 *
 * Денежные суммы: Точка принимает **рубли** числом → конвертируем
 * `amountKopecks / 100` (округление round). В webhook'е приходит так же.
 *
 * Retry: GET/DELETE до 3 попыток с экспоненциальным backoff'ом (250×2^n мс)
 * при HTTP ≥ 500. POST/PUT — без retry (idempotency-key мы не используем).
 *
 * Webhook парсинг и верификация JWT-подписи вынесены в отдельный сервис
 * (`TochkaWebhookVerifierService`), но методы интерфейса `parseWebhook` и
 * `verifyWebhookSignature` всё равно остаются здесь — провайдер их
 * делегирует verifier'у.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.3 + port-brief §6.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import type {
  BankInvoiceFileResult,
  BillingProviderPort,
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
  RegisterWebhooksRequest,
  RegisterWebhooksResult,
  WebhookEvent,
} from '../billing-provider.port';
import { BillingProviderResourceNotFoundError } from '../billing-provider.port';

import { TochkaOAuthService } from './tochka-oauth.service';
import { TochkaWebhookVerifierService } from './tochka-webhook-verifier.service';
import {
  TOCHKA_SANDBOX_BEARER_TOKEN,
  type TochkaEnvelope,
} from './tochka.types';

interface RequestInitWithRetry extends Omit<RequestInit, 'method'> {
  method?: string;
  retryable?: boolean;
  parseAs?: 'json' | 'buffer';
  headers?: Record<string, string>;
}

@Injectable()
export class TochkaBillingProvider implements BillingProviderPort {
  readonly providerName = 'tochka' as const;
  private readonly logger = new Logger(TochkaBillingProvider.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(TochkaOAuthService)
    private readonly oauth?: TochkaOAuthService,
    @Optional()
    @Inject(TochkaWebhookVerifierService)
    private readonly verifier?: TochkaWebhookVerifierService,
  ) {}

  // ════════════════════════ ACQUIRING ════════════════════════

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const response = await this.request<TochkaEnvelope<Record<string, unknown>>>(
      `/acquiring/${this.apiVersion}/payments`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: this.compact({
            customerCode: req.customerCode ?? this.customerCode(),
            amount: this.kopecksToRubles(req.amountKopecks),
            purpose: req.description,
            paymentMode: req.paymentMode ?? ['card', 'sbp'],
            redirectUrl: req.returnUrl,
            failRedirectUrl: req.failReturnUrl,
            saveCard: req.saveCard,
            consumerId: req.consumerId,
            merchantId: req.merchantId ?? this.merchantId(),
            ttl: req.ttlMinutes,
            paymentLinkId: req.paymentLinkId ?? req.invoiceId,
          }),
        }),
      },
    );
    const data = (response.Data ?? {}) as Record<string, string | undefined>;
    return {
      providerInvoiceId: data.operationId ?? data.paymentId ?? req.invoiceId,
      paymentUrl: data.paymentLink,
      externalStatus: data.status,
      status: this.mapAcquiringStatus(data.status),
    };
  }

  async createRecurringSubscription(
    req: CreateRecurringSubscriptionRequest,
  ): Promise<CreateRecurringSubscriptionResult> {
    if (req.recurring && req.options) {
      // Tochka API не разрешает recurring=true и Options одновременно.
      throw new Error(
        'Tochka: createRecurringSubscription нельзя вызывать с recurring=true и options одновременно',
      );
    }
    const response = await this.request<TochkaEnvelope<Record<string, unknown>>>(
      `/acquiring/${this.apiVersion}/subscriptions`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: this.compact({
            customerCode: req.customerCode,
            amount: this.kopecksToRubles(req.amountKopecks),
            purpose: req.description,
            redirectUrl: req.returnUrl,
            failRedirectUrl: req.failReturnUrl,
            saveCard: req.saveCard,
            recurring: req.recurring,
            Options: req.options,
            paymentLinkId: req.paymentLinkId ?? req.invoiceId,
            merchantId: this.merchantId(),
          }),
        }),
      },
    );
    const data = (response.Data ?? {}) as Record<string, string | undefined>;
    return {
      providerSubscriptionId:
        data.subscriptionId ?? data.operationId ?? req.invoiceId,
      providerInvoiceId: data.operationId ?? data.paymentId,
      paymentUrl: data.paymentLink,
      consumerId: data.consumerId,
      externalStatus: data.status,
    };
  }

  async chargeRecurringSubscription(
    req: ChargeRecurringSubscriptionRequest,
  ): Promise<ChargeRecurringSubscriptionResult> {
    // audit-fixes Б15: возвращаем РЕАЛЬНЫЙ operationId Точки, не
    // синтетический `${subId}:${Date.now()}`. Иначе webhook
    // BillingEventLog.externalEventId с настоящим operationId не найдёт
    // соответствующий Invoice и подписка падает в PAST_DUE при успешном
    // списании.
    const response = await this.request<TochkaEnvelope<Record<string, unknown>>>(
      `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(
        req.providerSubscriptionId,
      )}/charge`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: { amount: this.kopecksToRubles(req.amountKopecks) },
        }),
      },
    );
    const data = (response.Data ?? {}) as Record<string, string | undefined>;
    const operationId =
      data.operationId ?? data.paymentId ?? data.subscriptionPaymentId;
    if (!operationId) {
      // Точка не вернула operationId — это аномалия. Логируем и
      // фолбэчимся к синтетическому ID, чтобы Subscription.lastRenewalAttemptAt
      // обновилось и cron не зациклился, но Invoice по такому фолбэку
      // не финализируется (webhook искал бы по operationId).
      this.logger.warn(
        `chargeRecurringSubscription: Точка не вернула operationId (subId=${req.providerSubscriptionId})`,
      );
      return {
        providerInvoiceId: `${req.providerSubscriptionId}:${Date.now()}`,
        status: 'pending',
      };
    }
    return {
      providerInvoiceId: operationId,
      status: this.mapAcquiringStatus(data.status),
    };
  }

  async getRecurringSubscriptionStatus(
    providerSubscriptionId: string,
  ): Promise<string> {
    try {
      const response = await this.request<TochkaEnvelope<unknown>>(
        `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(
          providerSubscriptionId,
        )}/status`,
        { method: 'GET', retryable: true },
      );
      const raw = response.Data;
      const row = (Array.isArray(raw) ? raw[0] : raw) as
        | Record<string, string>
        | null
        | undefined;
      return String(
        row?.status ?? row?.subscriptionStatus ?? row?.State ?? 'Unknown',
      );
    } catch (err) {
      const parsed = this.parseTochkaRequestError(err);
      if (this.isResourceMissingResponse(parsed.status, parsed.body)) {
        return 'Cancelled';
      }
      throw err;
    }
  }

  async cancelRecurringSubscription(
    providerSubscriptionId: string,
  ): Promise<void> {
    try {
      await this.request(
        `/acquiring/${this.apiVersion}/subscriptions/${encodeURIComponent(
          providerSubscriptionId,
        )}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ Data: { status: 'Cancelled' } }),
        },
      );
    } catch (err) {
      const parsed = this.parseTochkaRequestError(err);
      if (this.isResourceMissingResponse(parsed.status, parsed.body)) return;
      throw err;
    }
  }

  async refundPayment(req: {
    providerInvoiceId: string;
    amountKopecks: number;
  }): Promise<void> {
    await this.request(
      `/acquiring/${this.apiVersion}/payments/${encodeURIComponent(
        req.providerInvoiceId,
      )}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: { amount: this.kopecksToRubles(req.amountKopecks) },
        }),
      },
    );
  }

  async getPaymentStatus(providerInvoiceId: string): Promise<PaymentStatusResult> {
    const path = `/acquiring/${this.apiVersion}/payments/${encodeURIComponent(
      providerInvoiceId,
    )}`;
    const { status, text } = await this.fetchWithStatus(path, {
      method: 'GET',
      retryable: true,
    });
    if (this.isResourceMissingResponse(status, text)) {
      throw new BillingProviderResourceNotFoundError(
        `Tochka payment ${providerInvoiceId} not found`,
      );
    }
    if (status < 200 || status >= 300) {
      throw new Error(`Tochka API error ${status}: ${text}`);
    }
    const json = JSON.parse(text) as TochkaEnvelope<{ status?: string }>;
    return {
      providerInvoiceId,
      status: this.mapOperationStatus(json.Data?.status),
    };
  }

  // ════════════════════════ BANK INVOICE ════════════════════════

  async createBankInvoice(
    req: CreateBankInvoiceRequest,
  ): Promise<CreateBankInvoiceResult> {
    const number = (req.invoiceNumber ?? req.invoiceId).slice(0, 32);
    const amountRub = this.kopecksToRubles(req.amountKopecks);
    const response = await this.request<TochkaEnvelope<Record<string, string>>>(
      `/invoice/${this.apiVersion}/bills`,
      {
        method: 'POST',
        body: JSON.stringify({
          Data: {
            accountId: req.accountId,
            customerCode: req.customerCode,
            SecondSide: this.compact({
              taxCode: req.payer.inn,
              type: req.payer.kpp ? 'company' : 'ip',
              secondSideName: req.payer.legalName,
              legalAddress: req.payer.legalAddress,
              kpp: req.payer.kpp,
            }),
            Content: {
              Invoice: this.compact({
                number,
                date: this.toDateString(new Date()),
                basedOn: req.description,
                comment: `Подписка ${this.toDateString(req.periodStart)} - ${this.toDateString(req.periodEnd)}`,
                paymentExpiryDate: req.dueDate
                  ? this.toDateString(req.dueDate)
                  : undefined,
                totalAmount: amountRub,
                totalNds: 0,
                Positions: [
                  {
                    positionName: req.description,
                    unitCode: 'услуга.',
                    ndsKind: 'without_nds',
                    price: amountRub,
                    quantity: 1,
                    totalAmount: amountRub,
                    totalNds: 0,
                  },
                ],
              }),
            },
          },
        }),
      },
    );
    const data = response.Data ?? {};
    return {
      providerInvoiceId: data.documentId ?? data.invoiceId ?? req.invoiceId,
      externalStatus: 'payment_waiting',
    };
  }

  async getBankInvoiceStatus(
    providerInvoiceId: string,
  ): Promise<GetBankInvoiceStatusResult> {
    const path = `/invoice/${this.apiVersion}/bills/${encodeURIComponent(
      this.customerCode(),
    )}/${encodeURIComponent(providerInvoiceId)}/payment-status`;
    const { status, text } = await this.fetchWithStatus(path, { method: 'GET' });
    if (this.isResourceMissingResponse(status, text)) {
      throw new BillingProviderResourceNotFoundError(
        `Tochka invoice ${providerInvoiceId} not found`,
      );
    }
    if (status < 200 || status >= 300) {
      throw new Error(`Tochka API error ${status}: ${text}`);
    }
    const json = JSON.parse(text) as TochkaEnvelope<{ paymentStatus?: string }>;
    const payStatus = (json.Data?.paymentStatus ??
      'payment_waiting') as GetBankInvoiceStatusResult['status'];
    return {
      providerInvoiceId,
      status: payStatus,
      paidAt: payStatus === 'payment_paid' ? new Date() : undefined,
    };
  }

  async sendBankInvoiceToEmail(req: {
    providerInvoiceId: string;
    email: string;
  }): Promise<void> {
    await this.request(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(
        this.customerCode(),
      )}/${encodeURIComponent(req.providerInvoiceId)}/email`,
      {
        method: 'POST',
        body: JSON.stringify({ Data: { email: req.email } }),
      },
    );
  }

  async getBankInvoiceFile(
    providerInvoiceId: string,
  ): Promise<BankInvoiceFileResult> {
    const buffer = await this.request<Buffer>(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(
        this.customerCode(),
      )}/${encodeURIComponent(providerInvoiceId)}/file`,
      { method: 'GET', parseAs: 'buffer', retryable: true },
    );
    return {
      content: buffer,
      contentType: 'application/pdf',
      fileName: `${providerInvoiceId}.pdf`,
    };
  }

  async deleteBankInvoice(providerInvoiceId: string): Promise<void> {
    await this.request(
      `/invoice/${this.apiVersion}/bills/${encodeURIComponent(
        this.customerCode(),
      )}/${encodeURIComponent(providerInvoiceId)}`,
      { method: 'DELETE' },
    );
  }

  // ════════════════════════ WEBHOOK ════════════════════════

  async registerWebhooks(req: RegisterWebhooksRequest): Promise<RegisterWebhooksResult> {
    const clientId = this.cfg.billing.tochka.clientId ?? 'test_app';
    const path = `/webhook/${this.apiVersion}/${encodeURIComponent(clientId)}`;
    const response = await this.request<TochkaEnvelope<{ webhooksList?: string[] }>>(
      path,
      {
        method: 'PUT',
        body: JSON.stringify({ url: req.url, webhooksList: req.events }),
      },
    );
    return {
      ok: true,
      webhookIds: response.Data?.webhooksList ?? [],
    };
  }

  parseWebhook(headers: Record<string, string>, body: unknown): WebhookEvent {
    if (!this.verifier) {
      throw new Error(
        'TochkaWebhookVerifierService не подключён — невозможно распарсить webhook',
      );
    }
    return this.verifier.parseWebhookEvent(headers, body);
  }

  async verifyWebhookSignature(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<boolean> {
    if (!this.verifier) {
      this.logger.warn(
        'TochkaWebhookVerifierService не подключён — webhook отклонён',
      );
      return false;
    }
    return this.verifier.verify(headers, body);
  }

  // ════════════════════════ HTTP-обёртка ════════════════════════

  private async request<T = unknown>(
    path: string,
    init: RequestInitWithRetry,
  ): Promise<T> {
    const parseAs = init.parseAs ?? 'json';
    const method = (init.method ?? 'GET').toUpperCase();
    const retryable = (init.retryable ?? false) && (method === 'GET' || method === 'DELETE');
    const attempts = retryable ? 3 : 1;

    let lastError: Error | null = null;
    const bearer = await this.getBearerToken();

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const url = new URL(path.replace(/^\//, ''), this.baseUrl());
        const response = await fetch(url, {
          ...init,
          method,
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          },
        });

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(`Tochka API error ${response.status}: ${text}`);
          if (!retryable || response.status < 500 || attempt === attempts) {
            throw error;
          }
          lastError = error;
          await this.sleep(250 * 2 ** (attempt - 1));
          continue;
        }

        if (response.status === 204) return undefined as T;
        if (parseAs === 'buffer') return Buffer.from(await response.arrayBuffer()) as T;

        const text = await response.text();
        if (!text.trim()) return undefined as T;
        return JSON.parse(text) as T;
      } catch (err) {
        if (!retryable || attempt === attempts) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
    throw lastError ?? new Error('Unknown Tochka request error');
  }

  private async fetchWithStatus(
    path: string,
    init: RequestInitWithRetry,
  ): Promise<{ status: number; text: string }> {
    const bearer = await this.getBearerToken();
    const url = new URL(path.replace(/^\//, ''), this.baseUrl());
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return { status: response.status, text: await response.text() };
  }

  // ════════════════════════ Helpers ════════════════════════

  private kopecksToRubles(amountKopecks: number): number {
    return Math.round(amountKopecks / 100);
  }

  private compact<T extends Record<string, unknown>>(input: T): T {
    return Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as T;
  }

  private isResourceMissingResponse(status: number, text: string): boolean {
    if (status === 404 || status === 410 || status === 424) return true;
    const sample = text.slice(0, 12_000).toLowerCase();
    return (
      sample.includes('не существует') ||
      sample.includes('does not exist') ||
      sample.includes('subscription not found')
    );
  }

  private parseTochkaRequestError(err: unknown): { status: number; body: string } {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^Tochka API error (\d+):\s*(.*)/s);
    if (match) return { status: Number(match[1]), body: match[2] ?? '' };
    return { status: 0, body: msg };
  }

  private mapAcquiringStatus(status?: string): 'pending' | 'succeeded' | 'failed' {
    if (status === 'APPROVED') return 'succeeded';
    if (status === 'REFUNDED' || status === 'EXPIRED') return 'failed';
    return 'pending';
  }

  private mapOperationStatus(
    status?: string,
  ): 'pending' | 'succeeded' | 'failed' | 'canceled' {
    if (status === 'APPROVED') return 'succeeded';
    if (status === 'REFUNDED' || status === 'EXPIRED') return 'failed';
    if (status === 'CANCELED' || status === 'Cancelled') return 'canceled';
    return 'pending';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private toDateString(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // ──────────────────────── config ────────────────────────

  private get apiVersion(): string {
    return this.cfg.billing.tochka.apiVersion;
  }

  private baseUrl(): string {
    return this.cfg.billing.tochka.baseUrl;
  }

  private customerCode(): string {
    const v = this.cfg.billing.tochka.customerCode;
    if (!v) {
      throw new Error('TOCHKA_CUSTOMER_CODE не задан в ENV');
    }
    return v;
  }

  private merchantId(): string | undefined {
    return this.cfg.billing.tochka.merchantId;
  }

  private async getBearerToken(): Promise<string> {
    if (this.cfg.billing.tochka.isSandbox) {
      return TOCHKA_SANDBOX_BEARER_TOKEN;
    }
    const explicit = this.cfg.billing.tochka.jwtToken;
    if (explicit) return explicit;
    const oauthToken = await this.oauth?.getAccessToken();
    if (oauthToken) return oauthToken;
    throw new Error(
      'Tochka bearer token не настроен (production). Запустите OAuth через /admin/billing/tochka/oauth/authorize-url.',
    );
  }
}
