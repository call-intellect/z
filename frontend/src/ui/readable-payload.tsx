'use client';

/**
 * Человекочитаемый рендер payload-объекта вместо сырого `JSON.stringify`.
 * Закрывает класс raw-json в курации (proposedPayload / triageReason) и
 * в карте знаний (атрибуты ребра графа).
 *
 * Принцип: пользователю показываем ТОЛЬКО поля, для которых есть русская
 * подпись (контентные поля карточки). Всё остальное — служебные ключи
 * (английские идентификаторы вроде `kind`/`weight`, пороги, `*Ids`) и вложенные
 * структуры — прячем под свёрнутые «Технические детали». Так английские
 * аббревиатуры и внутренние числа не торчат в интерфейсе пользователя.
 */

const FIELD_LABEL_RU: Record<string, string> = {
  // Контентные поля карточек знаний (proposedPayload специалистов Слоя 3).
  name: 'Название',
  title: 'Заголовок',
  statement: 'Формулировка',
  text: 'Текст',
  content: 'Содержание',
  contentMd: 'Содержание',
  description: 'Описание',
  summary: 'Краткое описание',
  rationale: 'Обоснование',
  reason: 'Причина',
  scope: 'Область применения',
  category: 'Категория',
  severity: 'Критичность',
  status: 'Статус',
  hypothesisText: 'Гипотеза',
  currentResult: 'Текущий результат',
  causeCategory: 'Категория причины',
  question: 'Вопрос',
  answer: 'Ответ',
  decision: 'Решение',
  deadline: 'Срок',
  note: 'Заметка',
  value: 'Значение',
  type: 'Тип',
  // `confidence`/`weight`/`*Ids` и прочие служебные числа НЕ показываем —
  // они уходят в свёрнутые «Технические детали».
};

/**
 * Перевод известных enum-значений, чтобы в значении контентного поля не
 * торчал английский (severity/status и т.п.). Неизвестное значение — как есть.
 */
const VALUE_LABEL_RU: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
  critical: 'критическая',
  open: 'открыт',
  proposed: 'предложено',
  accepted: 'принято',
  rejected: 'отклонено',
  done: 'выполнено',
  in_progress: 'в работе',
  planned: 'запланировано',
  active: 'активно',
  completed: 'завершено',
  cancelled: 'отменено',
  draft: 'черновик',
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function labelRu(key: string): string {
  return FIELD_LABEL_RU[key] ?? key;
}

function hasLabel(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELD_LABEL_RU, key);
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (typeof v === 'string') {
    const known = VALUE_LABEL_RU[v.toLowerCase()];
    if (known) return known;
    if (ISO_DATE_RE.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ru-RU');
    }
    return v;
  }
  return String(v);
}

export function ReadablePayload({ value }: { value: unknown }) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return <p className="text-sm text-fg-secondary">{renderValue(value)}</p>;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  // Видимый блок — только контентные поля с русской подписью и непустым
  // значением. Всё прочее (английские служебные ключи, числа-пороги, вложенные
  // структуры) уходит в свёрнутые «Технические детали».
  const primary = entries.filter(
    ([k, v]) => hasLabel(k) && v !== null && v !== '' && typeof v !== 'object',
  );
  const technical = entries.filter(
    ([k, v]) => v !== null && v !== '' && (typeof v === 'object' || !hasLabel(k)),
  );

  if (primary.length === 0 && technical.length === 0) {
    return <p className="text-sm text-fg-tertiary">—</p>;
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle bg-bg-card p-3 text-sm">
      {primary.length > 0 ? (
        <dl className="space-y-1">
          {primary.map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="shrink-0 text-fg-tertiary">{labelRu(k)}:</dt>
              <dd className="break-words text-fg-primary">{renderValue(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-fg-tertiary">
          Содержательных полей нет — подробности в технических деталях.
        </p>
      )}
      {technical.length > 0 && (
        <details className="text-xs text-fg-tertiary">
          <summary className="cursor-pointer select-none">
            Технические детали
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-bg-input p-2">
            {JSON.stringify(Object.fromEntries(technical), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
