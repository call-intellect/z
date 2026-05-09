import { ru, type Dict } from './ru';

// Тип, генерирующий dot-notation ключи из nested объекта словаря.
// Например: 'app.title' | 'errors.network' | ...
type DotNotation<T, P extends string = ''> = T extends object
  ? {
      [K in keyof T]: DotNotation<
        T[K],
        P extends '' ? K & string : `${P}.${K & string}`
      >;
    }[keyof T]
  : P;

export type I18nKey = DotNotation<Dict>;

export function t<K extends I18nKey>(key: K): string {
  const segs = key.split('.');
  let acc: unknown = ru;
  for (const seg of segs) {
    if (acc && typeof acc === 'object' && seg in (acc as Record<string, unknown>)) {
      acc = (acc as Record<string, unknown>)[seg];
    } else {
      return key;
    }
  }
  return typeof acc === 'string' ? acc : key;
}
