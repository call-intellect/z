/**
 * MockAdapter — фиксированные данные для dev/sandbox.
 *
 * Возвращает заранее известные ИНН реальных компаний (Сбер, Точка) и
 * `null` для всех остальных. Используется когда `INN_LOOKUP_PROVIDER=mock`
 * (по умолчанию). На MVP, sandbox-режиме Точки и без `DADATA_API_KEY`
 * это позволяет полностью пройти UX-сценарий регистрации/реферала.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8.
 */

import { Injectable } from '@nestjs/common';

import type { InnLookupAdapter, InnLookupResult } from './inn-lookup.adapter';

/** Анонимизированные dev-фикстуры. */
const FIXTURES: Record<string, InnLookupResult> = {
  // ПАО Сбербанк
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
  // АО «Точка»
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
  // ИП-фикстура для проверки payerType='individual_entrepreneur'
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
