'use client';

import { useId, type ReactNode } from 'react';
import type { ZodTypeAny } from 'zod';

import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';
import { Switch } from '@/ui/shadcn/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Универсальное поле редактирования для `AdminSetting`. Тип контрола
 * выводится из Zod-схемы:
 *   - `z.number()`            → `<Input type="number">` (с min/max из `bag`)
 *   - `z.boolean()`           → `<Switch>`
 *   - `z.enum([...])`         → `<Select>`
 *   - `z.string()` короткая   → `<Input type="text">`
 *   - `z.string()` от 100 сим → `<Textarea>` (по `bag.minimum`)
 *
 * Сложные типы (`z.object`, `z.array`) рендерятся как JSON-textarea — это
 * fallback для не-плоских настроек. Парсинг и валидация — на сервере.
 *
 * Совместим с zod 4: всю интроспекцию ведём через `.def.type` и `.bag` —
 * `_def.checks` в z4 больше не подходит.
 */
type Props<T> = {
  schema: ZodTypeAny;
  value: T | undefined;
  onChange: (next: T) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  /** Опциональный slot справа от label — например, кнопка «История». */
  rightSlot?: ReactNode;
};

export function AdminSettingField<T>({
  schema,
  value,
  onChange,
  label,
  description,
  disabled,
  error,
  className,
  rightSlot,
}: Props<T>) {
  const id = useId();
  const kind = detectFieldKind(schema);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-start justify-between gap-2">
        <label
          htmlFor={id}
          className="text-sm font-medium text-fg-primary"
        >
          {label}
        </label>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
      {description ? (
        <p className="text-xs text-fg-tertiary">{description}</p>
      ) : null}

      {kind.type === 'number' ? (
        <Input
          id={id}
          type="number"
          value={
            value === undefined || value === null
              ? ''
              : (value as unknown as number)
          }
          min={kind.min}
          max={kind.max}
          step={kind.isInt ? 1 : 'any'}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return;
            const num = Number(raw);
            if (Number.isFinite(num)) onChange(num as unknown as T);
          }}
        />
      ) : kind.type === 'boolean' ? (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked as unknown as T)}
          />
          <span className="text-xs text-fg-secondary">
            {Boolean(value) ? 'включено' : 'выключено'}
          </span>
        </div>
      ) : kind.type === 'enum' ? (
        <Select
          value={
            value === undefined || value === null
              ? undefined
              : String(value as unknown as string)
          }
          disabled={disabled}
          onValueChange={(next) => onChange(next as unknown as T)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Выберите значение…" />
          </SelectTrigger>
          <SelectContent>
            {kind.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                <span className="font-mono">{opt}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : kind.type === 'longString' ? (
        <Textarea
          id={id}
          value={(value as unknown as string) ?? ''}
          disabled={disabled}
          rows={6}
          onChange={(e) => onChange(e.target.value as unknown as T)}
        />
      ) : kind.type === 'json' ? (
        <Textarea
          id={id}
          value={safeStringify(value)}
          disabled={disabled}
          rows={6}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              onChange(parsed as unknown as T);
            } catch {
              // Невалидный JSON — игнорируем, ждём корректного ввода.
            }
          }}
          className="font-mono text-xs"
        />
      ) : (
        <Input
          id={id}
          type="text"
          value={(value as unknown as string) ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as unknown as T)}
        />
      )}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────── helpers ─────────────────────────

type FieldKind =
  | { type: 'number'; min?: number; max?: number; isInt: boolean }
  | { type: 'boolean' }
  | { type: 'enum'; options: string[] }
  | { type: 'string' }
  | { type: 'longString' }
  | { type: 'json' };

type ZodInternals = {
  def?: { type?: string; entries?: Record<string, string | number> };
  bag?: {
    minimum?: number;
    maximum?: number;
    format?: string;
  };
};

/**
 * Разбирает Zod-схему через публичные интернали v4:
 *  - `def.type` — корневой тип
 *  - `def.entries` — записи enum
 *  - `bag.minimum/maximum` — границы number/string
 *
 * Обёртки `optional/nullable/default` имеют `def.innerType` — раскручиваем
 * не более 5 уровней.
 */
function detectFieldKind(schema: ZodTypeAny): FieldKind {
  const unwrapped = unwrap(schema);
  const internals = readInternals(unwrapped);
  const t = internals.def?.type;

  if (t === 'number' || t === 'int') {
    const min = internals.bag?.minimum;
    const max = internals.bag?.maximum;
    const isInt = t === 'int' || internals.bag?.format === 'safeint';
    const result: FieldKind = { type: 'number', isInt };
    if (typeof min === 'number') result.min = min;
    if (typeof max === 'number') result.max = max;
    return result;
  }

  if (t === 'boolean') {
    return { type: 'boolean' };
  }

  if (t === 'enum') {
    const entries = internals.def?.entries ?? {};
    const options = Object.values(entries).filter(
      (v): v is string => typeof v === 'string',
    );
    return { type: 'enum', options };
  }

  if (t === 'string') {
    const minLength = internals.bag?.minimum;
    return {
      type: typeof minLength === 'number' && minLength >= 100 ? 'longString' : 'string',
    };
  }

  return { type: 'json' };
}

type SchemaShape = {
  _zod?: ZodInternals & { def?: { innerType?: unknown } };
  def?: ZodInternals['def'] & { innerType?: unknown };
  _def?: { type?: string; typeName?: string; innerType?: unknown };
  bag?: ZodInternals['bag'];
};

function readInternals(schema: ZodTypeAny): ZodInternals {
  // zod v4: публичный путь — `._zod`. Для обратной совместимости пробуем
  // и `.def` напрямую (внешний alias), и старый zod v3 `_def`.
  const s = schema as unknown as SchemaShape;
  if (s._zod) return s._zod;
  if (s.def) return { def: s.def, bag: s.bag };
  if (s._def) return { def: { type: s._def.typeName ?? s._def.type } };
  return {};
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  for (let i = 0; i < 5; i++) {
    const internals = readInternals(current);
    const t = internals.def?.type;
    if (t === 'optional' || t === 'nullable' || t === 'default' || t === 'prefault') {
      const cur = current as unknown as SchemaShape;
      const inner =
        cur._zod?.def?.innerType ?? cur.def?.innerType ?? cur._def?.innerType;
      if (inner) {
        current = inner as ZodTypeAny;
        continue;
      }
    }
    break;
  }
  return current;
}

function safeStringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
