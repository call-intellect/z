export class BillingProviderResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingProviderResourceNotFoundError';
  }
}

export interface CreatePaymentRequest {
  invoiceId: string;
  amountKopecks: number;
  currency: 'RUB';
  description: string;
  customerCode?: string;
  merchantId?: string;
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
  eventId: string;
  eventType: string;
  providerInvoiceId: string;
  status: string;
  amountKopecks?: number;
  currency?: string;
  paidAt?: Date;
  jti?: string | null;
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

export interface BillingProviderPort {
  readonly providerName: 'tochka' | 'manual';

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

  createBankInvoice(request: CreateBankInvoiceRequest): Promise<CreateBankInvoiceResult>;
  getBankInvoiceStatus(providerInvoiceId: string): Promise<GetBankInvoiceStatusResult>;
  sendBankInvoiceToEmail(request: { providerInvoiceId: string; email: string }): Promise<void>;
  getBankInvoiceFile(providerInvoiceId: string): Promise<BankInvoiceFileResult>;
  deleteBankInvoice(providerInvoiceId: string): Promise<void>;

  registerWebhooks?(request: RegisterWebhooksRequest): Promise<RegisterWebhooksResult>;
  parseWebhook(headers: Record<string, string>, body: unknown): WebhookEvent;
  verifyWebhookSignature(
    headers: Record<string, string>,
    body: unknown,
  ): boolean | Promise<boolean>;
}
