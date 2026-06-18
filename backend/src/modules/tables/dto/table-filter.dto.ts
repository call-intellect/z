import type { TablePropType } from '@prisma/client';
import { z } from 'zod';

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

export interface TableFilterCondition {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}

export const TableFilterConditionSchema = z.object({
  propertyId: z.string(),
  op: z.enum(FILTER_OPS),
  value: z.unknown().optional(),
});

export const TableFilterConditionsSchema = z.array(TableFilterConditionSchema);

const UNIVERSAL_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(['eq', 'neq', 'empty']);

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

export function isOpCompatible(op: FilterOp, type: TablePropType): boolean {
  if (UNIVERSAL_OPS.has(op)) return true;
  return TYPE_EXTRA_OPS[type]?.has(op) ?? false;
}

function isValueShapeValid(op: FilterOp, value: unknown): boolean {
  switch (op) {
    case 'empty':
      return true;
    case 'in':
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string');
    case 'before':
    case 'after': {
      if (typeof value !== 'string' || value.trim().length === 0) return false;
      return !Number.isNaN(Date.parse(value));
    }
    case 'older_than': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) && n > 0;
    }
    case 'contains':
      return typeof value === 'string' && value.trim().length > 0;
    case 'gt':
    case 'lt': {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') {
        const t = value.trim();
        return t.length > 0 && (Number.isFinite(Number(t)) || !Number.isNaN(Date.parse(t)));
      }
      return false;
    }
    case 'eq':
    case 'neq':
      return value !== undefined && value !== null;
    default:
      return false;
  }
}

export function cellMatchesCondition(cellValue: unknown, cond: TableFilterCondition): boolean {
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
      if (Array.isArray(cellValue)) {
        return cellValue.some((c) => needles.includes(String(c)));
      }
      if (isCellEmpty(cellValue)) return false;
      return needles.includes(String(cellValue));
    }
    case 'gt':
    case 'lt': {
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

function isCellEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isCellEmpty(a) || b === undefined || b === null) return false;
  return String(a) === String(b);
}

function cellToText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(' ');
  return null;
}

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
    if (!type) continue;
    if (!FILTER_OPS.includes(cond.op)) continue;
    if (!isOpCompatible(cond.op, type)) continue;
    if (!isValueShapeValid(cond.op, cond.value)) continue;

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
