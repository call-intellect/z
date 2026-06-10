'use client';

/**
 * Человекочитаемый рендер payload-объекта вместо сырого `JSON.stringify`.
 * Закрывает класс raw-json в курации (proposedPayload / triageReason):
 * верхнеуровневые осмысленные поля показываем списком «поле: значение»,
 * вложенные структуры прячем под «Технические детали» (details/summary).
 */

const FIELD_LABEL_RU: Record<string, string> = {
  name: 'Название',
  title: 'Заголовок',
  text: 'Текст',
  content: 'Содержание',
  description: 'Описание',
  summary: 'Краткое описание',
  reason: 'Причина',
  confidence: 'Уверенность',
  status: 'Статус',
  type: 'Тип',
  category: 'Категория',
  value: 'Значение',
  note: 'Заметка',
};

function labelRu(key: string): string {
  return FIELD_LABEL_RU[key] ?? key;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v);
}

export function ReadablePayload({ value }: { value: unknown }) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return <p className="text-sm text-fg-secondary">{renderValue(value)}</p>;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const simple = entries.filter(
    ([, v]) => v !== null && v !== '' && typeof v !== 'object',
  );
  const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');

  if (simple.length === 0 && complex.length === 0) {
    return <p className="text-sm text-fg-tertiary">—</p>;
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle bg-bg-card p-3 text-sm">
      {simple.length > 0 && (
        <dl className="space-y-1">
          {simple.map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-fg-tertiary">{labelRu(k)}:</dt>
              <dd className="break-words text-fg-primary">{renderValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {complex.length > 0 && (
        <details className="text-xs text-fg-tertiary">
          <summary className="cursor-pointer select-none">
            Технические детали
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-bg-input p-2">
            {JSON.stringify(Object.fromEntries(complex), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
