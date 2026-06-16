import { Injectable } from '@nestjs/common';

import type { InnLookupAdapter, InnLookupResult } from './inn-lookup.adapter';

const FIXTURES: Record<string, InnLookupResult> = {
  '7707083893': {
    source: 'mock',
    payerType: 'legal_entity',
    legalName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "СБЕРБАНК РОССИИ"',
    inn: '7707083893',
    kpp: '773601001',
    ogrn: '1027700132195',
    legalAddress: 'г. Москва, ул. Вавилова, д. 19',
    directorName: 'Греф Герман Оскарович',
    bankBik: null,
    bankAccount: null,
  },
  '9721194461': {
    source: 'mock',
    payerType: 'legal_entity',
    legalName: 'АКЦИОНЕРНОЕ ОБЩЕСТВО "ТОЧКА"',
    inn: '9721194461',
    kpp: '772101001',
    ogrn: '1227700185803',
    legalAddress: 'г. Москва, Летниковская ул., д. 2, стр. 4',
    directorName: 'Тимоничев Андрей Сергеевич',
    bankBik: '044525104',
    bankAccount: null,
  },
  '500100732259': {
    source: 'mock',
    payerType: 'individual_entrepreneur',
    legalName: 'Индивидуальный предприниматель Иванов Иван Иванович',
    inn: '500100732259',
    kpp: null,
    ogrn: '320500000000001',
    legalAddress: 'Московская область, г. Балашиха',
    directorName: 'Иванов Иван Иванович',
    bankBik: null,
    bankAccount: null,
  },
};

@Injectable()
export class MockAdapter implements InnLookupAdapter {
  readonly name = 'mock' as const;

  lookup(inn: string): Promise<InnLookupResult | null> {
    const normalized = inn.trim();
    return Promise.resolve(FIXTURES[normalized] ?? null);
  }
}
