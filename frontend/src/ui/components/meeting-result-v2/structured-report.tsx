import { type JSX } from 'react';

/**
 * ТЗ 2026-06-06 meeting-report-reliability-and-ui-honesty, Фаза 5 (S6-04).
 * Единый источник русских заголовков ключей structuredData/output отчёта +
 * человекочитаемый рендер значений (НЕ сырой JSON, НЕ англо-ключи). Используется
 * и в Обзоре (StructuredDataCard), и в диалоге отчёта (ReportOutputRenderer).
 */
export const STRUCTURED_FIELD_LABELS: Record<string, string> = {
  tasks: 'Задачи',
  action_items: 'Задачи',
  blockers: 'Блокеры',
  risks: 'Риски',
  decisions: 'Решения',
  agreements: 'Договорённости',
  discussed: 'Обсудили',
  topics: 'Темы',
  key_points: 'Ключевые моменты',
  next_step: 'Следующий шаг',
  next_steps: 'Следующие шаги',
  summary: 'Краткое содержание',
  pain: 'Проблема клиента',
  interest_level: 'Уровень интереса',
  objections: 'Возражения',
  budget: 'Бюджет',
  decision_maker: 'Кто принимает решение',
  urgency: 'Срочность',
  questions: 'Вопросы',
  sentiment: 'Настрой',
  participants: 'Участники',
  recommendations: 'Рекомендации',
  highlights: 'Важные моменты',
};

/** Заголовок поля: словарь, иначе snake_case/kebab → «Snake case». */
export function structuredFieldLabel(key: string): string {
  const mapped = STRUCTURED_FIELD_LABELS[key];
  if (mapped) return mapped;
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Пустое значение → секцию скрываем (S6-04: «blockers: []» не показывать). */
export function isEmptyStructuredValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Главный текст из объекта-задачи: title/text/name/description/первое строковое поле. */
function objectMainText(o: Record<string, unknown>): string {
  for (const k of ['title', 'text', 'name', 'description', 'value']) {
    const val = o[k];
    if (typeof val === 'string' && val.trim()) return val;
  }
  for (const val of Object.values(o)) {
    if (typeof val === 'string' && val.trim()) return val;
  }
  return '—';
}

/** Доп. подпись задачи: исполнитель/срок, если есть (S6-04: скрывать null). */
function objectMeta(o: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const assignee = o['assignee'] ?? o['owner'] ?? o['assigneeRaw'];
  if (typeof assignee === 'string' && assignee.trim()) parts.push(assignee);
  const due = o['dueDate'] ?? o['due'] ?? o['deadline'];
  if (typeof due === 'string' && due.trim()) parts.push(`до ${due}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Значение поля отчёта человекочитаемо: массив строк → список; массив объектов
 * (задачи) → список заголовков (+ исполнитель/срок); вложенный объект → подписи
 * ключей; строка/число/булево → текст. Никогда не сырой JSON.
 */
export function StructuredFieldValue({ value }: { value: unknown }): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="text-fg-tertiary">—</span>;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-tertiary">—</span>;
    return (
      <ul className="flex flex-col gap-1">
        {value.map((item, i) => {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            const o = item as Record<string, unknown>;
            const meta = objectMeta(o);
            return (
              <li key={i} className="flex flex-col">
                <span>{objectMainText(o)}</span>
                {meta && <span className="text-xs text-fg-tertiary">{meta}</span>}
              </li>
            );
          }
          return <li key={i}>{String(item)}</li>;
        })}
      </ul>
    );
  }
  const o = value as Record<string, unknown>;
  const inner = Object.entries(o).filter(([, v]) => !isEmptyStructuredValue(v));
  if (inner.length === 0) return <span className="text-fg-tertiary">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {inner.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <span className="text-xs text-fg-tertiary">{structuredFieldLabel(k)}</span>
          <StructuredFieldValue value={v} />
        </div>
      ))}
    </div>
  );
}

/**
 * Значение секции → markdown-текст (текстовое зеркало `StructuredFieldValue`).
 *   - массив строк → '- item';
 *   - массив объектов (задачи) → '- {objectMainText} (— {objectMeta})';
 *   - вложенный объект → '**Подпись**: значение' по непустым полям;
 *   - примитив → как есть.
 * Реюзает те же `objectMainText`/`objectMeta`/`structuredFieldLabel`, что и UI-рендер.
 */
export function structuredValueToMarkdown(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const meta = objectMeta(o);
          return `- ${objectMainText(o)}${meta ? ` — ${meta}` : ''}`;
        }
        return `- ${String(item)}`;
      })
      .join('\n');
  }
  const o = value as Record<string, unknown>;
  const inner = Object.entries(o).filter(([, v]) => !isEmptyStructuredValue(v));
  if (inner.length === 0) return '—';
  return inner
    .map(([k, v]) => `**${structuredFieldLabel(k)}**: ${structuredValueToMarkdown(v)}`)
    .join('\n');
}

/**
 * structuredData/output → markdown (текстовое зеркало `ReportOutputRenderer`):
 * каждый непустой top-level ключ → '## Заголовок' + сериализованное значение.
 * Пустые секции (`isEmptyStructuredValue`) пропускаются. Примитивный output —
 * как есть. Используется кнопками «Скопировать текст / Скачать / Печать».
 */
export function structuredReportToMarkdown(output: unknown, title?: string): string {
  if (output == null || typeof output !== 'object') {
    return title
      ? `# ${title}\n\n${String(output ?? '')}`.trim()
      : String(output ?? '');
  }
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`, '');
  }
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (isEmptyStructuredValue(value)) continue;
    lines.push(`## ${structuredFieldLabel(key)}`);
    lines.push(structuredValueToMarkdown(value));
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** Та же сериализация, но без markdown-разметки: '#' убраны, '- ' → '• '. */
export function structuredReportToPlainText(output: unknown, title?: string): string {
  return structuredReportToMarkdown(output, title)
    .replace(/^#+\s*/gm, '')
    .replace(/^-\s*/gm, '• ');
}
