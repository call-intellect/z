/**
 * Контракт адаптера ИНН-лукапа (mock / dadata / tochka).
 *
 * `InnLookupService` маршрутизирует запросы по `INN_LOOKUP_PROVIDER`:
 *   - `mock`               → MockAdapter
 *   - `dadata`             → DadataAdapter
 *   - `tochka_then_dadata` → TochkaAdapter → DadataAdapter (fallback)
 *
 * Возвращаемый `InnLookupResult.source` указывает фактический источник
 * данных (важно для UI: подсветка «данные из Точки» vs «данные из DaData»).
 *
 * Адаптер НЕ кэширует — кэш реализован централизованно в `InnLookupService`,
 * чтобы переключение провайдера не сбрасывало кэш.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8.
 */

/**
 * Тип плательщика. Маппится из DaData (`type: INDIVIDUAL | LEGAL`) и Точки
 * (`info.kpp` — заполнен у юрлица). `self_employed` (НПД) явно отличается
 * от ИП только в DaData по `opf.code` — на MVP мы маппим всех `INDIVIDUAL`
 * в `individual_entrepreneur`, пользователь корректирует руками в форме
 * реферала.
 */
export type InnPayerType =
  | 'legal_entity'
  | 'individual_entrepreneur'
  | 'self_employed';

export interface InnLookupResult {
  /** Откуда фактически пришли данные (для UI). */
  source: 'mock' | 'dadata' | 'tochka';
  payerType: InnPayerType;
  legalName: string;
  inn: string;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  directorName?: string | null;
  /** Банковские реквизиты — заполнены только у Tochka OpenBanking. */
  bankBik?: string | null;
  bankAccount?: string | null;
}

/**
 * Адаптер лукапа. Возвращает `null` если по ИНН ничего не найдено
 * (не throw — провайдер хочет дать fallback'у шанс). Бросает только при
 * технических ошибках (HTTP 5xx, таймаут, неверный JSON).
 */
export interface InnLookupAdapter {
  readonly name: 'mock' | 'dadata' | 'tochka';
  lookup(inn: string): Promise<InnLookupResult | null>;
}
