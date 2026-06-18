import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type { InnLookupAdapter, InnLookupResult } from './inn-lookup.adapter';

const DADATA_FINDBYID_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';

const REQUEST_TIMEOUT_MS = 5000;

interface DadataSuggestionData {
  inn?: string;
  kpp?: string | null;
  ogrn?: string | null;
  type?: 'LEGAL' | 'INDIVIDUAL';
  name?: {
    full_with_opf?: string;
    short_with_opf?: string;
  };
  address?: {
    value?: string;
  };
  management?: {
    name?: string;
  };
  opf?: {
    code?: string;
  };
}

interface DadataResponse {
  suggestions?: Array<{ data?: DadataSuggestionData }>;
}

@Injectable()
export class DadataAdapter implements InnLookupAdapter {
  readonly name = 'dadata' as const;
  private readonly logger = new Logger(DadataAdapter.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async lookup(inn: string): Promise<InnLookupResult | null> {
    const apiKey = this.cfg.billing.dadata.apiKey;
    if (!apiKey) {
      this.logger.warn('DadataAdapter.lookup вызван без DADATA_API_KEY — возвращаю null');
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(DADATA_FINDBYID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify({ query: inn.trim(), branch_type: 'MAIN' }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(`DaData findById вернул HTTP ${response.status}: ${text.slice(0, 200)}`);
        return null;
      }

      const payload = (await response.json()) as DadataResponse;
      const candidate = payload.suggestions?.[0]?.data;
      if (!candidate?.inn) return null;

      return {
        source: 'dadata',
        payerType: candidate.type === 'INDIVIDUAL' ? 'individual_entrepreneur' : 'legal_entity',
        legalName: candidate.name?.full_with_opf ?? candidate.name?.short_with_opf ?? candidate.inn,
        inn: candidate.inn,
        kpp: candidate.kpp ?? null,
        ogrn: candidate.ogrn ?? null,
        legalAddress: candidate.address?.value ?? null,
        directorName: candidate.management?.name ?? null,
        bankBik: null,
        bankAccount: null,
      };
    } catch (err) {
      if (controller.signal.aborted) {
        this.logger.warn(
          `DaData findById timeout (>${REQUEST_TIMEOUT_MS}ms) для inn=${DadataAdapter.maskInn(inn)}`,
        );
      } else {
        this.logger.warn(
          `DaData findById error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  static maskInn(rawInn: string): string {
    const digits = rawInn.replace(/\D/g, '');
    if (digits.length <= 4) return '***';
    return `***${digits.slice(-4)}`;
  }
}
