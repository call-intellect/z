import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { TochkaOAuthService } from '../../billing/providers/tochka/tochka-oauth.service';

import type { InnLookupAdapter, InnLookupResult } from './inn-lookup.adapter';

interface TochkaCustomer {
  customerCode?: string;
  customerId?: string;
  id?: string;
}

interface TochkaCustomerInfo {
  customerCode?: string;
  name?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  bankCode?: string;
  AccountList?: Array<{ accountId?: string }>;
}

const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class TochkaOpenBankingAdapter implements InnLookupAdapter {
  readonly name = 'tochka' as const;
  private readonly logger = new Logger(TochkaOpenBankingAdapter.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TochkaOAuthService) private readonly oauth: TochkaOAuthService,
  ) {}

  async lookup(inn: string): Promise<InnLookupResult | null> {
    if (this.cfg.billing.tochka.isSandbox) {
      return null;
    }
    if (!this.cfg.billing.features.tochka) {
      this.logger.warn('FEATURE_BILLING_TOCHKA=false — Tochka lookup пропущен');
      return null;
    }

    const bearer = await this.oauth.getAccessToken();
    if (!bearer) {
      this.logger.warn(
        'Tochka access_token недоступен — авторизуйтесь через ' +
          '/admin/billing/tochka/oauth/authorize-url',
      );
      return null;
    }

    try {
      const customers = await this.fetchCustomersList(bearer);
      const normalizedInn = inn.trim();
      for (const customer of customers) {
        const code = customer.customerCode ?? customer.customerId ?? customer.id;
        if (!code) continue;
        const info = await this.fetchCustomerInfo(code, bearer).catch(() => null);
        if (!info || info.inn !== normalizedInn) continue;

        const firstAccount = info.AccountList?.[0]?.accountId;
        return {
          source: 'tochka',
          payerType: info.kpp ? 'legal_entity' : 'individual_entrepreneur',
          legalName: info.name ?? normalizedInn,
          inn: info.inn ?? normalizedInn,
          kpp: info.kpp ?? null,
          ogrn: info.ogrn ?? null,
          legalAddress: info.address ?? null,
          directorName: null,
          bankBik: info.bankCode ?? null,
          bankAccount: firstAccount ? (firstAccount.split('/')[0] ?? null) : null,
        };
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Tochka lookup error для ${inn}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async fetchCustomersList(bearer: string): Promise<TochkaCustomer[]> {
    const url = new URL(
      `open-banking/${this.cfg.billing.tochka.apiVersion}/customers`,
      this.cfg.billing.tochka.baseUrl,
    );
    const response = await this.fetchWithTimeout(url, bearer);
    if (!response.ok) {
      throw new Error(`Tochka customers list: HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      Data?: TochkaCustomer[] | { Customer?: TochkaCustomer[]; Customers?: TochkaCustomer[] };
    };
    const data = json.Data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      return data.Customer ?? data.Customers ?? [];
    }
    return [];
  }

  private async fetchCustomerInfo(
    customerCode: string,
    bearer: string,
  ): Promise<TochkaCustomerInfo | null> {
    const url = new URL(
      `open-banking/${this.cfg.billing.tochka.apiVersion}/customers/${encodeURIComponent(customerCode)}`,
      this.cfg.billing.tochka.baseUrl,
    );
    const response = await this.fetchWithTimeout(url, bearer);
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as { Data?: TochkaCustomerInfo };
    return json.Data ?? null;
  }

  private async fetchWithTimeout(url: URL, bearer: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
