'use client';

import type { MeetingType } from '@/domain/enums';
import { t } from '@/lib/i18n';

type Props = {
  type: MeetingType;
  data: unknown;
};

/**
 * Универсальный рендер структурированного отчёта.
 *
 * `structuredData` — JSON, форма которого зависит от типа встречи (см. бизнес
 * шаблоны в `second-brain/01_projects/ai-analysis-by-type.md`). На MVP мы
 * рендерим его в общем виде «карточки полей» — каждое top-level поле
 * становится отдельной карточкой с заголовком и значением.
 *
 * Если value — массив строк, рендерим как список. Если массив объектов —
 * как блоки. Если значение — объект, рендерим вложенные пары.
 */
export function ReportByType({ type, data }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('result.report')}
        </h2>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {t(`meeting_types.${type}.label`)}
        </span>
      </header>
      <div className="flex flex-col gap-4">
        <RenderValue value={data} />
      </div>
    </section>
  );
}

function RenderValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="text-sm text-slate-400">—</span>;
  }
  if (typeof value === 'string') {
    return <p className="whitespace-pre-line text-sm text-slate-800">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-sm text-slate-800">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-slate-400">—</span>;
    }
    if (value.every((v) => typeof v === 'string')) {
      return (
        <ul className="list-disc pl-5 text-sm text-slate-800">
          {(value as string[]).map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {value.map((v, i) => (
          <div
            key={i}
            className="rounded border border-slate-100 bg-slate-50 p-3"
          >
            <RenderValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-sm text-slate-400">—</span>;
    }
    if (depth === 0) {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {entries.map(([k, v]) => (
            <div
              key={k}
              className="rounded border border-slate-100 bg-slate-50 p-4"
            >
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {humanize(k)}
              </h3>
              <RenderValue value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      );
    }
    return (
      <dl className="space-y-2 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-slate-500">
              {humanize(k)}
            </dt>
            <dd>
              <RenderValue value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-sm text-slate-500">{JSON.stringify(value)}</span>;
}

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
