import type { TablePropType } from '@prisma/client';
import { z } from 'zod';

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 5) — NL Saved Views.
 *
 * Контракт фильтра таблицы: набор условий `{ propertyId, op, value? }`,
 * которые фронт применяет к строкам клиент-сайд. Бэкенд лишь конвертирует
 * NL-запрос пользователя в этот JSON (через LLM) и валидирует его против
 * реальной схемы колонок таблицы. ВАЖНО: фронт обязан применять операторы по
 * ровно той же семантике, что описана ниже (и в системном промпте) — иначе
 * результат разойдётся с ожиданием пользователя.
 *
 * Семантика операторов:
 *   - `eq`/`neq`   — равно / не равно (любой тип).
 *   - `contains`   — подстрока (text/longtext/email/phone/url).
 *   - `gt`/`lt`    — больше / меньше (number/currency/percent/date).
 *   - `before`     — дата строго раньше заданной ISO-даты (date; value — строка-дата).
 *   - `after`      — дата строго позже заданной ISO-даты (date; value — строка-дата).
 *   - `older_than` — значение-дата старше, чем N дней назад (date; value — число дней).
 *
 * Точка отсчёта дат — UTC-календарная дата. `today` в промпте формируется как
 * UTC `ГГГГ-ММ-ДД` (`toISOString().slice(0,10)`), а before/after/older_than
 * считаются от неё; фронт сравнивает даты в UTC. То есть «сегодня» и границы
 * суток едины для всех часовых поясов (по UTC), а не по локальному времени
 * клиента.
 *   - `in`         — значение ∈ массив (selectSingle/selectMulti/status/person; value — string[]).
 *   - `empty`      — ячейка пуста (любой тип; value не нужен).
 */

/** Операторы фильтра (Фаза 5). */
export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'contains',
  'in',
  'empty',
  'before',
  'after',
  'older_than',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Одно условие фильтра. */
export interface TableFilterCondition {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}

/**
 * Zod-схема одного условия. Намеренно мягкая по `value` (z.unknown): жёсткую
 * проверку формы value под конкретный оператор делаем в `validateFilters`,
 * чтобы одно кривое условие не валило весь массив (LLM может галлюцинировать).
 */
export const TableFilterConditionSchema = z.object({
  propertyId: z.string(),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

/** Массив условий фильтра. */
export const TableFilterConditionsSchema = z.array(TableFilterConditionSchema);

// ─────────────────── совместимость op × TablePropType ─────────────────────
//
// Какие операторы допустимы для каждого типа колонки. Источник правды и для
// валидатора, и для системного промпта (каталог операторов). Типы, которых нет
// в карте (formula/relation/rollup/file/checkbox/служебные createdAt/...),
// поддерживают только универсальные операторы (eq/neq/empty) — см.
// UNIVERSAL_OPS.

/** Универсальные операторы — допустимы для ЛЮБОГО типа колонки. */
const UNIVERSAL_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'eq',
  'neq',
  'empty',
]);

/**
 * Дополнительные операторы по типам (поверх универсальных).
 * Карта НЕ обязана покрывать все TablePropType — отсутствующий тип получает
 * только UNIVERSAL_OPS.
 */
const TYPE_EXTRA_OPS: Partial<Record<TablePropType, ReadonlySet<FilterOp>>> = {
  text: new Set<FilterOp>(['contains']),
  longtext: new Set<FilterOp>(['contains']),
  email: new Set<FilterOp>(['contains']),
  phone: new Set<FilterOp>(['contains']),
  url: new Set<FilterOp>(['contains']),
  number: new Set<FilterOp>(['gt', 'lt']),
  currency: new Set<FilterOp>(['gt', 'lt']),
  percent: new Set<FilterOp>(['gt', 'lt']),
  date: new Set<FilterOp>(['gt', 'lt', 'before', 'after', 'older_than']),
  status: new Set<FilterOp>(['in']),
  selectSingle: new Set<FilterOp>(['in']),
  selectMulti: new Set<FilterOp>(['in']),
  person: new Set<FilterOp>(['in']),
};

/** Совместим ли оператор `op` с типом колонки `type`. */
export function isOpCompatible(op: FilterOp, type: TablePropType): boolean {
  if (UNIVERSAL_OPS.has(op)) return true;
  return TYPE_EXTRA_OPS[type]?.has(op) ?? false;
}

/** Корректна ли форма `value` под оператор. */
function isValueShapeValid(op: FilterOp, value: unknown): boolean {
  switch (op) {
    case 'empty':
      // value не нужен — игнорируем что бы ни прислали.
      return true;
    case 'in':
      // непустой массив строк. Пустой `in` бессмыслен (ничего не отберёт) —
      // отбрасываем, чтобы не «прятать» весь набор строк ложным условием.
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => typeof v === 'string')
      );
    case 'before':
    case 'after': {
      // строка-дата, парсится в валидную дату.
      if (typeof value !== 'string' || value.trim().length === 0) return false;
      return !Number.isNaN(Date.parse(value));
    }
    case 'older_than': {
      // число дней (положительное).
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) && n > 0;
    }
    case 'contains':
      // непустая строка-подстрока.
      return typeof value === 'string' && value.trim().length > 0;
    case 'gt':
    case 'lt': {
      // число (number/currency/percent) или строка, парсящаяся в число ИЛИ
      // дату (для date-колонок). Произвольный текст («дорогой») отбрасываем —
      // иначе validateFilters пропустил бы заведомо несравнимое условие.
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') {
        const t = value.trim();
        return (
          t.length > 0 &&
          (Number.isFinite(Number(t)) || !Number.isNaN(Date.parse(t)))
        );
      }
      return false;
    }
    case 'eq':
    case 'neq':
      // любой не-undefined.
      return value !== undefined && value !== null;
    default:
      return false;
  }
}

/**
 * Chat-v2 как параллельный источник (ТЗ 2026-06-15 §7, ЧАСТЬ B) — server-side
 * применение условия к ОДНОЙ ячейке. Семантика ровно та же, что описана в шапке
 * этого файла (источник правды для фронта и для chat_v2). Это позволяет
 * `applyFilterToRows` (TableSemanticFilterService) отбирать строки на бэке для
 * подмешивания в контекст AI-чата, не дублируя семантику операторов.
 *
 * Чистая функция без сайд-эффектов. Любая неоднозначность приведения (число не
 * парсится, дата невалидна и т.п.) → НЕ матчит (false), а не бросает.
 */
export function cellMatchesCondition(
  cellValue: unknown,
  cond: TableFilterCondition,
): boolean {
  const { op, value } = cond;

  switch (op) {
    case 'empty':
      return isCellEmpty(cellValue);
    case 'eq':
      return looseEquals(cellValue, value);
    case 'neq':
      return !looseEquals(cellValue, value);
    case 'contains': {
      if (typeof value !== 'string') return false;
      const hay = cellToText(cellValue);
      if (hay === null) return false;
      return hay.toLowerCase().includes(value.toLowerCase());
    }
    case 'in': {
      if (!Array.isArray(value)) return false;
      const needles = value.map((v) => String(v));
      // selectMulti/person — ячейка может быть массивом; иначе скаляр.
      if (Array.isArray(cellValue)) {
        return cellValue.some((c) => needles.includes(String(c)));
      }
      if (isCellEmpty(cellValue)) return false;
      return needles.includes(String(cellValue));
    }
    case 'gt':
    case 'lt': {
      // Сначала пробуем числа, затем даты (для date-колонок).
      const cellNum = toNumberOrNull(cellValue);
      const valNum = toNumberOrNull(value);
      if (cellNum !== null && valNum !== null) {
        return op === 'gt' ? cellNum > valNum : cellNum < valNum;
      }
      const cellDate = toDateMsOrNull(cellValue);
      const valDate = toDateMsOrNull(value);
      if (cellDate !== null && valDate !== null) {
        return op === 'gt' ? cellDate > valDate : cellDate < valDate;
      }
      return false;
    }
    case 'before':
    case 'after': {
      const cellDate = toDateMsOrNull(cellValue);
      const valDate = toDateMsOrNull(value);
      if (cellDate === null || valDate === null) return false;
      return op === 'before' ? cellDate < valDate : cellDate > valDate;
    }
    case 'older_than': {
      // value — число дней; строка-дата старше, чем N дней назад.
      const days = toNumberOrNull(value);
      const cellDate = toDateMsOrNull(cellValue);
      if (days === null || days <= 0 || cellDate === null) return false;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      return cellDate < cutoff;
    }
    default:
      return false;
  }
}

/**
 * ЧАСТЬ B — строка проходит фильтр, если удовлетворяет ВСЕМ условиям (AND).
 * Пустой массив условий → строка проходит (нет фильтра). `cells` —
 * `{ propertyId: value }`; для empty/in отсутствующий ключ трактуется как пусто.
 */
export function rowMatchesConditions(
  cells: Record<string, unknown>,
  conditions: ReadonlyArray<TableFilterCondition>,
): boolean {
  for (const cond of conditions) {
    const cellValue = cells[cond.propertyId];
    if (!cellMatchesCondition(cellValue, cond)) return false;
  }
  return true;
}

/** Пуста ли ячейка (null/undefined/''/[]). */
function isCellEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Свободное равенство по строковому представлению (number 100 == "100"). */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isCellEmpty(a) || b === undefined || b === null) return false;
  return String(a) === String(b);
}

/** Ячейка как текст (для contains). Массив → join; объект → null. */
function cellToText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(' ');
  return null;
}

/** Приведение к конечному числу или null. */
function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Приведение к timestamp (ms) или null. */
function toDateMsOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length === 0) return null;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Валидирует условия фильтра против реальной схемы колонок таблицы. Оставляет
 * только условия, где:
 *   (а) `propertyId` реально присутствует среди `properties`;
 *   (б) `op` совместим с типом колонки (карта совместимости выше);
 *   (в) `value` имеет правильную форму под оператор.
 * Невалидные условия молча отбрасываются (не бросает исключений). Возвращает
 * очищенный массив — он и есть итоговый фильтр.
 */
export function validateFilters(
  filters: ReadonlyArray<TableFilterCondition>,
  properties: ReadonlyArray<{ id: string; type: TablePropType }>,
): TableFilterCondition[] {
  const typeById = new Map<string, TablePropType>();
  for (const p of properties) typeById.set(p.id, p.type);

  const out: TableFilterCondition[] = [];
  for (const cond of filters) {
    if (!cond || typeof cond.propertyId !== 'string') continue;
    const type = typeById.get(cond.propertyId);
    if (!type) continue; // (а) колонки нет в таблице
    if (!FILTER_OPS.includes(cond.op)) continue;
    if (!isOpCompatible(cond.op, type)) continue; // (б) op ∤ type
    if (!isValueShapeValid(cond.op, cond.value)) continue; // (в) кривой value

    // Нормализуем: для empty value не несём дальше.
    if (cond.op === 'empty') {
      out.push({ propertyId: cond.propertyId, op: 'empty' });
    } else {
      out.push({
        propertyId: cond.propertyId,
        op: cond.op,
        value: cond.value,
      });
    }
  }
  return out;
}
