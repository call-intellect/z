/**
 * DadataAdapter — лукап ИНН через DaData Suggestions API.
 *
 * Endpoint:
 *   POST https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party
 *   Headers: { Authorization: 'Token <DADATA_API_KEY>', Content-Type: application/json }
 *   Body:    { query: '<inn>', branch_type: 'MAIN' }
 *
 * Response format:
 *   {
 *     suggestions: [{
 *       data: {
 *         inn, kpp, ogrn,
 *         type: 'LEGAL' | 'INDIVIDUAL',
 *         name: { full_with_opf },
 *         address: { value },
 *         management?: { name },
 *         opf?: { code }  — '50102' для НПД (самозанятых)
 *       }
 *     }]
 *   }
 *
 * Маппинг payerType:
 *   - type='LEGAL'      → 'legal_entity'
 *   - type='INDIVIDUAL' → 'individual_entrepreneur' (по умолчанию)
 *
 * Самозанятые (НПД) в DaData возвращаются как `type='INDIVIDUAL'` + специальный
 * `opf.code`. На MVP: маппим в `individual_entrepreneur`, пользователь
 * корректирует руками. Точное определение НПД — TODO.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type { InnLookupAdapter, InnLookupResult } from './inn-lookup.adapter';

const DADATA_FINDBYID_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';

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
      this.logger.warn(
        'DadataAdapter.lookup вызван без DADATA_API_KEY — возвращаю null',
      );
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
        this.logger.warn(
          `DaData findById вернул HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
        // 4xx — это «не найдено / неверный ключ»; не ретраим, отдаём null
        // и даём fallback'у шанс. 5xx — тоже null, чтобы не падать в UI;
        // в проде CallerInvariant: если все источники молчат — 404 в сервисе.
        return null;
      }

      const payload = (await response.json()) as DadataResponse;
      const candidate = payload.suggestions?.[0]?.data;
      if (!candidate?.inn) return null;

      return {
        source: 'dadata',
        payerType:
          candidate.type === 'INDIVIDUAL'
            ? 'individual_entrepreneur'
            : 'legal_entity',
        legalName:
          candidate.name?.full_with_opf ??
          candidate.name?.short_with_opf ??
          candidate.inn,
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
          `DaData findById timeout (>${REQUEST_TIMEOUT_MS}ms) для inn=${inn}`,
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
}
