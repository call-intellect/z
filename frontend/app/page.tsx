import Link from 'next/link';
import { t } from '@/lib/i18n';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold text-slate-900">{t('app.title')}</h1>
      <p className="text-lg text-slate-600">{t('app.tagline')}</p>
      <Link
        href="/meetings/create"
        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-5 py-2.5 text-base font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {t('meetings.create')}
      </Link>
    </main>
  );
}
