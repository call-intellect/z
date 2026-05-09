'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import { t } from '@/lib/i18n';

type Props = { markdown: string };

export function CustomReportMd({ markdown }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        {t('result.custom_report')}
      </h2>
      <div className="prose prose-slate max-w-none text-sm">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{markdown}</ReactMarkdown>
      </div>
    </section>
  );
}
