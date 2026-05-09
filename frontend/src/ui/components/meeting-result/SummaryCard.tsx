import { t } from '@/lib/i18n';

type Props = { summary: string };

export function SummaryCard({ summary }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        {t('result.summary')}
      </h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {summary}
      </p>
    </section>
  );
}
