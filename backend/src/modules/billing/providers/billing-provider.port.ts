/**
 * BillingProviderPort — абстракция внешнего платёжного провайдера.
 *
 * Реализации:
 *   - `ManualBillingProvider` (этот модуль) — заглушка для admin-only
 *     сценариев. Все методы throw'ят (исключение: webhook-методы возвращают
 *     no-op, чтобы фабрика провайдеров не падала когда BILLING_PROVIDER=manual
 *     и webhook-эндпоинт всё равно поднят).
 *   - `TochkaBillingProvider` (Фаза 5) — реальная интеграция с Точкой.
 *
 * Выбор реализации — через ENV `BILLING_PROVIDER` + feature-flag
 * `FEATURE_BILLING_TOCHKA` (см. BillingModule.useFactory в Фазе 4b).
 *
 * Денежные суммы — **копейки** (Int). Конкретные провайдеры конвертируют в
 * нужный формат внутри (Точка принимает рубли числом → /100 в её адаптере).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.2 + port-brief §5.
 */

// ────────────────────────── Ошибки ──────────────────────────

/** Кидается провайдером когда внешний ресурс (платёж/инвойс/подписка) не
 *  найден (HTTP 404/410/424 у Точки). Не путать с `NotFoundException` Nest. */
export class BillingProviderResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingProviderResourceNotFoundError';
  }
}

// ────────────────────────── Запросы / ответы ──────────────────────────

export interface CreatePaymentRequest {
  /** Наш `Invoice.id` — провайдер должен сохранить как `paymentLinkId`. */
  invoiceId: string;
  amountKopecks: number;
  currency: 'RUB';
  description: string;
  customerCode?: string;
  merchantId?: string;
  /** ID платёжной ссылки (по умолчанию = invoiceId). */
  paymentLinkId?: string;
  paymentMode?: Array<'card' | 'sbp' | 'tinkoff' | 'dolyame'>;
  returnUrl?: string;
  failReturnUrl?: string;
  saveCard?: boolean;
  consumerId?: string;
  ttlMinutes?: number;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerInvoiceId: string;
  paymentUrl?: string;
  externalStatus?: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface CreateBankInvoiceRequest {
  invoiceId: string;
  invoiceNumber?: string;
  amountKopecks: number;
  description: string;
  customerCode: string;
  accountId: string;
  payer: {
    legalName: string;
    inn: string;
    kpp?: string | null;
    legalAddress: string;
    contactEmail: string;
    contactPhone?: string | null;
  };
  periodStart: Date;
  periodEnd: Date;
  dueDate?: Date;
}

export interface CreateBankInvoiceResult {
  providerInvoiceId: string;
  externalStatus: string;
}

export interface GetBankInvoiceStatusResult {
  providerInvoiceId: string;
  status: 'payment_waiting' | 'payment_expired' | 'payment_paid';
  paidAt?: Date;
}

export interface CreateRecurringSubscriptionRequest {
  invoiceId: string;
  amountKopecks: number;
  description: string;
  customerCode: string;
  paymentLinkId?: string;
  returnUrl?: string;
  failReturnUrl?: string;
  saveCard?: boolean;
  recurring?: boolean;
  options?: {
    trancheCount?: number;
    period?: 'Day' | 'Month';
    daysInPeriod?: number;
  };
}

export interface CreateRecurringSubscriptionResult {
  providerSubscriptionId: string;
  providerInvoiceId?: string;
  paymentUrl?: string;
  consumerId?: string;
  externalStatus?: string;
}

export interface ChargeRecurringSubscriptionRequest {
  providerSubscriptionId: string;
  amountKopecks: number;
}

export interface ChargeRecurringSubscriptionResult {
  providerInvoiceId: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentStatusResult {
  providerInvoiceId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  paidAt?: Date;
}

export interface WebhookEvent {
  /** Идентификатор события для дедупа: `<type>:<operationId>:<status>`. */
  eventId: string;
  eventType: string;
  providerInvoiceId: string;
  status: string;
  /** Сумма в копейках (для UI; не используется в верификации). */
  amountKopecks?: number;
  currency?: string;
  paidAt?: Date;
  /**
   * audit Б4 (2026-05-29): JWT-jti для replay-защиты на уровне БД.
   * null если провайдер не положил jti в payload (legacy fallback).
   */
  jti?: string | null;
  /**
   * audit В3 (2026-05-29): customerCode из payload — сверяется
   * с `cfg.billing.tochka.customerCode` чтобы webhook от чужого
   * customer'а не финализировал наш Invoice. null если провайдер
   * не положил поле (manual / legacy).
   */
  customerCode?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface RegisterWebhooksRequest {
  url: string;
  events: string[];
}

export interface RegisterWebhooksResult {
  ok: boolean;
  webhookIds?: string[];
}

export interface BankInvoiceFileResult {
  content: Buffer;
  contentType: string;
  fileName?: string;
}

// ────────────────────────── Интерфейс ──────────────────────────

export interface BillingProviderPort {
  /** Имя провайдера для логов/метрик/BillingEventLog.providerName. */
  readonly providerName: 'tochka' | 'manual';

  // Acquiring (карта/СБП) ─────────────────────────────
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  createRecurringSubscription(
    request: CreateRecurringSubscriptionRequest,
  ): Promise<CreateRecurringSubscriptionResult>;
  chargeRecurringSubscription(
    request: ChargeRecurringSubscriptionRequest,
  ): Promise<ChargeRecurringSubscriptionResult>;
  getRecurringSubscriptionStatus(providerSubscriptionId: string): Promise<string>;
  cancelRecurringSubscription(providerSubscriptionId: string): Promise<void>;
  refundPayment(request: { providerInvoiceId: string; amountKopecks: number }): Promise<void>;
  getPaymentStatus(providerInvoiceId: string): Promise<PaymentStatusResult>;

  // Bank invoice (безнал) ─────────────────────────────
  createBankInvoice(request: CreateBankInvoiceRequest): Promise<CreateBankInvoiceResult>;
  getBankInvoiceStatus(providerInvoiceId: string): Promise<GetBankInvoiceStatusResult>;
  sendBankInvoiceToEmail(request: {
    providerInvoiceId: string;
    email: string;
  }): Promise<void>;
  getBankInvoiceFile(providerInvoiceId: string): Promise<BankInvoiceFileResult>;
  deleteBankInvoice(providerInvoiceId: string): Promise<void>;

  // Webhook ───────────────────────────────────────────
  registerWebhooks?(request: RegisterWebhooksRequest): Promise<RegisterWebhooksResult>;
  parseWebhook(headers: Record<string, string>, body: unknown): WebhookEvent;
  verifyWebhookSignature(
    headers: Record<string, string>,
    body: unknown,
  ): boolean | Promise<boolean>;
}
